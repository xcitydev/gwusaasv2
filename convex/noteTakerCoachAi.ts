"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { z } from "zod";
import { sendChatMessage } from "./lib/recall";
import {
  COACH_CHAT_PLATFORMS,
  formatClock,
  type AgendaItem,
  type CoachState,
} from "../lib/note-taker";

/**
 * Agenda Coach — the loop. Every ~45 s while the bot records: read the
 * last few minutes of live transcript, ask a small model which agenda item
 * is being discussed and whether the talk has drifted, apply the timebox
 * and talk-balance rules locally, and deliver at most one nudge (private
 * panel always; meeting chat when allowed and not too soon after the last).
 */

const MODEL = "claude-haiku-4-5-20251001";
const TICK_MS = 45_000;
const WAIT_MS = 30_000;
/** ~6 h of ticks — far past any meeting. */
const MAX_TICKS = 480;
/** A nudge stays on the card this long unless replaced. */
const NUDGE_TTL_MS = 3 * 60_000;
const BALANCE_SHARE = 0.7;
const BALANCE_MIN_TALK_SEC = 300;
const BALANCE_EVERY_MS = 10 * 60_000;

const verdictSchema = z.object({
  // Index into the agenda (0-based) or null when nothing matches / no agenda.
  currentItemIndex: z.number().nullable(),
  currentTopic: z.string(),
  offTopic: z.boolean(),
  // One short sentence, only when offTopic.
  driftSummary: z.string().nullable(),
  // A steering question the host could ask next, or null.
  suggestedQuestion: z.string().nullable(),
});

const SYSTEM =
  "You are a silent meeting coach watching a live transcript against an " +
  "agenda. Decide which agenda item (0-based index) the LAST minute or two " +
  "of conversation belongs to, or null if none / no agenda. offTopic is " +
  "true only when the recent talk clearly belongs to no agenda item for a " +
  "sustained stretch (small tangents are fine). driftSummary: what they " +
  "drifted to, five to ten words, else null. suggestedQuestion: one short, " +
  "natural question the host could ask to move the meeting forward (toward " +
  "the current item, or the next one when the current item seems finished); " +
  "null if nothing useful. Never invent facts. Be conservative.";

function emptyState(): CoachState {
  return {
    currentItem: null,
    itemLog: [],
    elapsedSec: 0,
    topic: null,
    offTopic: false,
    suggestion: null,
    nudge: null,
    nudgeKind: null,
    talk: [],
    updatedAt: Date.now(),
    lastChatNudgeAt: null,
    lastBalanceNudgeAt: null,
    overrunNotifiedPct: 0,
    tickScheduled: false,
    ticks: 0,
    tileOn: false,
  };
}

type ExtendedState = CoachState & { segmentCount?: number; nudgeAt?: number | null };

export const tick = internalAction({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<void> => {
    const data = await ctx.runQuery(internal.noteTakerCoach.getCoachContext, {
      meetingId: args.meetingId,
    });
    if (!data) return;
    const { meeting, settings } = data;
    const state: ExtendedState = {
      ...emptyState(),
      ...((meeting.coachState as ExtendedState | undefined) ?? {}),
    };
    const save = async (next: ExtendedState) =>
      await ctx.runMutation(internal.noteTakerCoach.saveCoachState, {
        meetingId: args.meetingId,
        coachState: { ...next, updatedAt: Date.now() },
      });
    const finish = async () => await save({ ...state, tickScheduled: false });

    const live = ["joining", "waiting_room", "recording"].includes(meeting.status);
    if (!settings.enabled || meeting.finalizedAt || !live || state.ticks >= MAX_TICKS) {
      await finish();
      return;
    }
    if (meeting.status !== "recording") {
      await save({ ...state, tickScheduled: true });
      await ctx.scheduler.runAfter(WAIT_MS, internal.noteTakerCoachAi.tick, args);
      return;
    }

    const now = Date.now();
    const agenda = (meeting.agenda ?? []) as AgendaItem[];
    const elapsedSec = Math.max(
      data.lastEnd,
      meeting.startedAt ? (now - meeting.startedAt) / 1000 : 0,
    );
    const newWords = data.segmentCount > (state.segmentCount ?? 0);
    let next: ExtendedState = {
      ...state,
      ticks: state.ticks + 1,
      elapsedSec,
      talk: data.talk,
      segmentCount: data.segmentCount,
      tickScheduled: true,
    };

    // ── What are they talking about? ──────────────────────────────────
    if (newWords && process.env.ANTHROPIC_API_KEY && data.recent.length > 0) {
      try {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
        const client = new Anthropic();
        const agendaText =
          agenda.length > 0
            ? agenda.map((a, i) => `${i}. ${a.title} (${a.minutes} min)`).join("\n")
            : "(no agenda set)";
        const transcript = data.recent
          .map((s) => `[${formatClock(s.start)}] ${s.speaker}: ${s.text}`)
          .join("\n");
        const response = await client.messages.parse({
          model: MODEL,
          max_tokens: 400,
          system: SYSTEM,
          messages: [
            {
              role: "user",
              content:
                `Agenda:\n${agendaText}\n\n` +
                `Elapsed: ${formatClock(elapsedSec)}. Previously on item: ${state.currentItem ?? "none"}.\n\n` +
                `Recent transcript:\n${transcript}`,
            },
          ],
          output_config: { format: zodOutputFormat(verdictSchema) },
        });
        const verdict = response.parsed_output;
        if (verdict) {
          const index =
            verdict.currentItemIndex !== null &&
            verdict.currentItemIndex >= 0 &&
            verdict.currentItemIndex < agenda.length
              ? verdict.currentItemIndex
              : null;
          next.topic = verdict.currentTopic.slice(0, 120);
          next.offTopic = verdict.offTopic;
          next.suggestion = verdict.suggestedQuestion?.slice(0, 200) ?? null;
          if (index !== next.currentItem) {
            const log = next.itemLog.map((entry) =>
              entry.endedSec === null ? { ...entry, endedSec: elapsedSec } : entry,
            );
            if (index !== null) log.push({ index, startedSec: elapsedSec, endedSec: null });
            next = { ...next, currentItem: index, itemLog: log, overrunNotifiedPct: 0 };
          }
          if (verdict.offTopic && verdict.driftSummary) next.topic = verdict.driftSummary.slice(0, 120);
        }
      } catch (error) {
        console.error("Agenda coach verdict failed:", error);
      }
    }

    // ── Rules: timebox, drift, balance ────────────────────────────────
    let nudge: { kind: CoachState["nudgeKind"]; message: string } | null = null;
    const current = next.currentItem !== null ? agenda[next.currentItem] : null;
    const open = next.itemLog.find((entry) => entry.endedSec === null);
    if (current && open && current.minutes > 0) {
      const onItemSec = elapsedSec - open.startedSec;
      const pct = (onItemSec / (current.minutes * 60)) * 100;
      const step = Math.floor(pct / 50) * 50;
      if (pct >= 100 && step > next.overrunNotifiedPct) {
        const overMin = Math.max(1, Math.round((onItemSec - current.minutes * 60) / 60));
        const following = next.currentItem !== null ? agenda[next.currentItem + 1] : undefined;
        nudge = {
          kind: "overrun",
          message: `${overMin} min over on "${current.title}"${following ? ` — next up: "${following.title}"` : ""}.`,
        };
        next.overrunNotifiedPct = step;
      }
    }
    if (!nudge && newWords && next.offTopic && next.topic) {
      nudge = {
        kind: "drift",
        message: `We have drifted to ${next.topic}${current ? ` — back to "${current.title}"?` : "."}${next.suggestion ? ` ${next.suggestion}` : ""}`,
      };
    }
    if (!nudge && data.totalTalkSec >= BALANCE_MIN_TALK_SEC) {
      const top = data.talk[0];
      const since = now - (next.lastBalanceNudgeAt ?? 0);
      if (top && top.share >= BALANCE_SHARE && data.talk.length > 1 && since >= BALANCE_EVERY_MS) {
        nudge = {
          kind: "balance",
          message: `${top.name} has ${Math.round(top.share * 100)}% of the talk time — a good moment to hear from others.`,
        };
        next.lastBalanceNudgeAt = now;
      }
    }

    // ── Deliver ───────────────────────────────────────────────────────
    if (nudge) {
      const channels = ["panel", ...(next.tileOn ? ["tile"] : [])];
      const chatOk =
        settings.chat &&
        Boolean(meeting.recallBotId) &&
        COACH_CHAT_PLATFORMS.includes(meeting.platform ?? "") &&
        now - (next.lastChatNudgeAt ?? 0) >= settings.nudgeMin * 60_000;
      if (chatOk) {
        try {
          await sendChatMessage(meeting.recallBotId!, `Agenda coach: ${nudge.message}`);
          next.lastChatNudgeAt = now;
          channels.push("chat");
        } catch (error) {
          console.error("Agenda coach chat nudge failed:", error);
        }
      }
      next.nudge = nudge.message;
      next.nudgeKind = nudge.kind;
      next.nudgeAt = now;
      await ctx.runMutation(internal.noteTakerCoach.logEvent, {
        meetingId: args.meetingId,
        kind: nudge.kind ?? "next",
        message: nudge.message,
        channels,
      });
    } else if (next.nudge && next.nudgeAt && now - next.nudgeAt > NUDGE_TTL_MS) {
      next.nudge = null;
      next.nudgeKind = null;
    }

    await save(next);
    await ctx.scheduler.runAfter(TICK_MS, internal.noteTakerCoachAi.tick, args);
  },
});
