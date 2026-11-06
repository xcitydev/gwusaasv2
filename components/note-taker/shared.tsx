"use client";

import type { FunctionReturnType } from "convex/server";
import { openTopUp, promptTopUpIfInsufficient } from "@/lib/top-up-prompt";
import { Timer } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  MEETING_PLATFORMS,
  MEETING_STATUSES,
  type MeetingPlatform,
  type MeetingStatus,
} from "@/lib/note-taker";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/public-errors";
import { MEETING_TEMPLATES, isMeetingType } from "@/lib/meeting-templates";
import { scoreClass } from "@/lib/meeting-score";

export type Overview = NonNullable<
  FunctionReturnType<typeof api.noteTaker.overview>
>;
export type MeetingRow = FunctionReturnType<
  typeof api.noteTaker.liveMeetings
>[number];

export function serverMessage(e: unknown, fallback: string): string {
  return errorText(e, fallback);
}

/** Friendly copy for the errors every note-taker action can throw. */
export function friendlyError(e: unknown, fallback: string): string {
  const msg = serverMessage(e, fallback);
  if (msg.includes("INSUFFICIENT_CREDITS")) {
    // Opens the app-wide top-up dialog with the exact gap as well.
    promptTopUpIfInsufficient(e, "Sending the note taker");
    return "Not enough credits to record a meeting — top up first.";
  }
  if (msg.includes("NOT_CONFIGURED")) {
    return msg.replace("NOT_CONFIGURED: ", "");
  }
  return msg;
}

export function StatusBadge({ status }: { status: MeetingStatus }) {
  const meta = MEETING_STATUSES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
        meta.className,
      )}
    >
      {status === "recording" && (
        <span className="size-1.5 animate-pulse rounded-full bg-red-400" />
      )}
      {meta.label}
    </span>
  );
}

export function platformLabel(platform: string | null | undefined): string {
  return platform && platform in MEETING_PLATFORMS
    ? MEETING_PLATFORMS[platform as MeetingPlatform]
    : "Meeting";
}

/** "≈ 3 h 20 m of recording left" from the credit balance, with Top up. */
export function MinutesMeter({
  overview,
  compact = false,
}: {
  overview: Pick<Overview, "credits" | "creditsPerMinute" | "minCredits">;
  compact?: boolean;
}) {
  const minutes =
    overview.creditsPerMinute > 0 ? Math.floor(overview.credits / overview.creditsPerMinute) : 0;
  const low = overview.credits < overview.minCredits;
  const label =
    minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m` : `${minutes} m`;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
        low ? "bg-amber-500/10 text-amber-400" : "bg-secondary/50 text-muted-foreground",
        compact && "px-2 py-1",
      )}
    >
      <Timer className="size-3.5 shrink-0" />
      <span className="flex-1">
        {low ? (
          <>Not enough credits to record (needs {overview.minCredits}).</>
        ) : (
          <>
            ≈ <span className="font-medium text-foreground">{label}</span> of recording left
          </>
        )}
      </span>
      {(low || minutes < 120) && (
        <button
          type="button"
          onClick={() => openTopUp({ context: "Note taker" })}
          className="shrink-0 font-medium text-primary hover:underline"
        >
          Top up
        </button>
      )}
    </div>
  );
}

export function TypeChip({ type }: { type: string | null | undefined }) {
  if (!isMeetingType(type) || type === "general") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
        MEETING_TEMPLATES[type].className,
      )}
    >
      {MEETING_TEMPLATES[type].label}
    </span>
  );
}

export function ScoreChip({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return null;
  return (
    <span
      title="Meeting Score — talk balance, questions, outcomes and tone"
      className={cn(
        "inline-flex min-w-8 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none",
        scoreClass(score),
      )}
    >
      {score}
    </span>
  );
}

export function FolderChip({ name, color }: { name: string; color?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] leading-none text-muted-foreground">
      <span
        className="size-1.5 rounded-full"
        style={{ background: color ?? "currentColor" }}
        aria-hidden
      />
      {name}
    </span>
  );
}

/** Monday of the week `ms` falls in (local time). */
export function weekStart(ms: number): number {
  const date = new Date(ms);
  const day = (date.getDay() + 6) % 7; // Mon = 0
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date.getTime();
}

/** "This week", "Last week", or "Week of Sep 21–27". */
export function weekLabel(startMs: number): string {
  const thisWeek = weekStart(Date.now());
  if (startMs === thisWeek) return "This week";
  if (startMs === weekStart(thisWeek - 1)) return "Last week";
  const start = new Date(startMs);
  const end = new Date(startMs + 6 * 24 * 60 * 60_000);
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
  const range =
    start.getMonth() === end.getMonth()
      ? `${month(start)} ${start.getDate()}–${end.getDate()}`
      : `${month(start)} ${start.getDate()} – ${month(end)} ${end.getDate()}`;
  const year =
    start.getFullYear() !== new Date().getFullYear() ? `, ${start.getFullYear()}` : "";
  return `Week of ${range}${year}`;
}

export function whenLabel(ms: number): string {
  const date = new Date(ms);
  const today = new Date();
  const sameDay = today.toDateString() === date.toDateString();
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return `Today, ${time}`;
  return `${date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })}, ${time}`;
}
