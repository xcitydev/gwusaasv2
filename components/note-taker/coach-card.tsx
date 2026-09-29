"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatClock, type AgendaItem, type CoachState } from "@/lib/note-taker";
import { cn } from "@/lib/utils";

/**
 * The live coach card. Rendered two ways: full-screen at /coach/<token>
 * (the meeting bot shows this page as its camera, 1280×720) and compact
 * inside the Agenda Coach tab's private panel.
 */

/** Seconds spent per agenda item so far, from the coach's item log. */
export function itemSeconds(
  agenda: AgendaItem[],
  state: CoachState | null,
  elapsedSec: number,
): number[] {
  const seconds = agenda.map(() => 0);
  for (const entry of state?.itemLog ?? []) {
    if (seconds[entry.index] === undefined) continue;
    const end = entry.endedSec ?? elapsedSec;
    seconds[entry.index] += Math.max(0, end - entry.startedSec);
  }
  return seconds;
}

/** Elapsed seconds now, extrapolated from the last coach tick while live. */
export function liveElapsed(state: CoachState | null, live: boolean): number {
  if (!state) return 0;
  if (!live) return state.elapsedSec;
  return state.elapsedSec + Math.max(0, (Date.now() - state.updatedAt) / 1000);
}

function useClock(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

export function AgendaProgress({
  agenda,
  state,
  elapsedSec,
  compact,
}: {
  agenda: AgendaItem[];
  state: CoachState | null;
  elapsedSec: number;
  compact?: boolean;
}) {
  const spent = itemSeconds(agenda, state, elapsedSec);
  const current = state?.currentItem ?? null;
  const doneIndexes = new Set(
    (state?.itemLog ?? []).filter((e) => e.endedSec !== null).map((e) => e.index),
  );
  return (
    <ol className={cn("flex flex-col", compact ? "gap-2" : "gap-3")}>
      {agenda.map((item, index) => {
        const budget = item.minutes * 60;
        const used = spent[index];
        const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
        const over = budget > 0 && used > budget;
        const isCurrent = index === current;
        const isDone = !isCurrent && doneIndexes.has(index) && current !== null && index < current;
        return (
          <li
            key={`${index}-${item.title}`}
            className={cn(
              "rounded-xl border px-3 py-2",
              isCurrent ? "border-primary/60 bg-primary/10" : "border-white/10 bg-white/[0.03]",
              compact ? "text-sm" : "text-lg",
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-full font-semibold",
                  compact ? "size-6 text-xs" : "size-8 text-sm",
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : isDone
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-white/10 text-white/70",
                )}
              >
                {index + 1}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", isDone && "text-white/50 line-through")}>
                {item.title}
              </span>
              <span
                className={cn(
                  "shrink-0 font-mono",
                  compact ? "text-xs" : "text-base",
                  over ? "text-red-400" : "text-white/70",
                )}
              >
                {formatClock(used)} / {item.minutes}m
              </span>
            </div>
            <div className={cn("mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10")}>
              <div
                className={cn("h-full rounded-full transition-[width]", over ? "bg-red-400" : isCurrent ? "bg-primary" : "bg-emerald-400/70")}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function TalkBalance({
  talk,
  compact,
}: {
  talk: CoachState["talk"];
  compact?: boolean;
}) {
  const top = talk.slice(0, 4);
  if (top.length === 0) return null;
  return (
    <ul className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}>
      {top.map((person) => (
        <li key={person.name} className={cn("flex items-center gap-2", compact ? "text-xs" : "text-sm")}>
          <span className="w-28 truncate text-white/80">{person.name}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn("h-full rounded-full", person.share >= 0.7 ? "bg-amber-400" : "bg-primary/80")}
              style={{ width: `${Math.round(person.share * 100)}%` }}
            />
          </div>
          <span className="w-10 text-right font-mono text-white/70">{Math.round(person.share * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

/** Full-screen card for the bot camera (1280×720 canvas). */
export function CoachCard({ token }: { token: string }) {
  const data = useQuery(api.noteTakerCoach.coachCard, { token });
  const live = data?.status === "recording";
  useClock(Boolean(live));
  const state = (data?.coachState as CoachState | null | undefined) ?? null;
  const elapsed = liveElapsed(state, Boolean(live));
  const agenda = (data?.agenda ?? []) as AgendaItem[];

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black text-white">
      <div className="relative flex h-[720px] w-[1280px] flex-col gap-6 overflow-hidden bg-[#0a0a0a] p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-primary/20 blur-3xl"
        />
        <header className="relative flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-primary">
              Agenda coach
            </p>
            <h1 className="mt-1 max-w-3xl truncate text-3xl font-bold">
              {data === undefined ? "Loading…" : data === null ? "This card has expired" : data.title}
            </h1>
          </div>
          <div className="text-right">
            <p className="font-mono text-5xl font-bold tabular-nums">{formatClock(elapsed)}</p>
            <p className="text-sm text-white/60">
              {live ? "in progress" : data?.status === "scheduled" ? "waiting to start" : (data?.status ?? "")}
            </p>
          </div>
        </header>

        {data && (
          <div className="relative grid flex-1 grid-cols-[1.4fr_1fr] gap-8">
            <section className="min-h-0 overflow-hidden">
              {agenda.length > 0 ? (
                <AgendaProgress agenda={agenda} state={state} elapsedSec={elapsed} />
              ) : (
                <p className="text-xl text-white/60">
                  No agenda yet — add one in the Agenda Coach tab and it appears here.
                </p>
              )}
            </section>
            <section className="flex min-h-0 flex-col gap-5">
              <div
                className={cn(
                  "rounded-2xl border p-5",
                  state?.nudge
                    ? state.nudgeKind === "overrun"
                      ? "border-red-400/50 bg-red-500/10"
                      : "border-primary/50 bg-primary/10"
                    : "border-white/10 bg-white/[0.03]",
                )}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
                  {state?.nudge ? "Nudge" : "Status"}
                </p>
                <p className="mt-2 text-2xl font-semibold leading-snug">
                  {state?.nudge ??
                    (state?.topic
                      ? `On track: ${state.topic}`
                      : live
                        ? "Listening…"
                        : "The coach starts when the recording does.")}
                </p>
                {state?.suggestion && !state.nudge && (
                  <p className="mt-3 text-lg text-white/75">Try: “{state.suggestion}”</p>
                )}
              </div>
              {state && state.talk.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
                    Talk time
                  </p>
                  <TalkBalance talk={state.talk} />
                </div>
              )}
            </section>
          </div>
        )}
        <footer className="relative text-xs text-white/40">
          {data?.botName ?? "Notetaker"} · live agenda coach
        </footer>
      </div>
    </div>
  );
}
