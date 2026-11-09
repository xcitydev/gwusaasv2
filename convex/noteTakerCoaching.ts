import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { computeAnalytics } from "./lib/transcript";
import {
  FILLER_TARGET_PER_MIN,
  PACE_TARGET,
  type CoachingMoment,
  type MeetingAnalytics,
} from "../lib/note-taker";

/**
 * Coaching across meetings — YOUR pace, filler words, questions and talk
 * share over time (Read.ai's Speaker Coach). Which transcript speaker is
 * "you" comes from a pick on the meeting, a remembered alias, or your name.
 */

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Which speaker in this meeting is the user, if we can tell. */
function selfIn(
  meeting: Doc<"meetings">,
  analytics: MeetingAnalytics,
  names: Set<string>,
): string | null {
  if (meeting.selfSpeaker) return meeting.selfSpeaker;
  const match = analytics.speakers.find((s) => names.has(normalise(s.name)));
  return match?.name ?? null;
}

type CoachingRow = {
  meetingId: Id<"meetings">;
  title: string;
  at: number;
  talkSec: number;
  share: number;
  wpm: number;
  fillerPerMin: number | null;
  questions: number;
  longestMonologueSec: number;
  paceOff: boolean;
  fillerHigh: boolean;
};

export const coachingSummary = query({
  args: { days: v.number() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return null;
    const aliases = await ctx.db
      .query("noteSpeakerAliases")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(50);
    const names = new Set(
      [user.name ?? "", ...aliases.map((a) => a.name)].filter(Boolean).map(normalise),
    );
    const since = Date.now() - Math.min(365, Math.max(1, args.days)) * 24 * 60 * 60_000;
    const recent = await ctx.db
      .query("meetings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(400);

    const rows: CoachingRow[] = [];
    const moments: (CoachingMoment & { meetingId: string; title: string })[] = [];
    const unidentified = [];
    for (const meeting of recent) {
      const at = meeting.startedAt ?? meeting._creationTime;
      if (at < since || meeting.status !== "done" || meeting.userId !== user._id) continue;
      const analytics = meeting.analytics as MeetingAnalytics | undefined;
      if (!analytics || analytics.speakers.length === 0) continue;
      const self = selfIn(meeting, analytics, names);
      if (!self) {
        if (unidentified.length < 10) {
          unidentified.push({
            meetingId: meeting._id,
            title: meeting.title,
            at,
            speakers: analytics.speakers.map((s) => s.name).slice(0, 12),
          });
        }
        continue;
      }
      const me = analytics.speakers.find((s) => s.name === self);
      if (!me || me.talkSec < 30) continue;
      rows.push({
        meetingId: meeting._id,
        title: meeting.title,
        at,
        talkSec: me.talkSec,
        share: me.share,
        wpm: me.wordsPerMinute,
        fillerPerMin: me.fillerPerMin ?? null,
        questions: me.questions,
        longestMonologueSec: me.longestMonologueSec,
        paceOff: me.wordsPerMinute < PACE_TARGET.min || me.wordsPerMinute > PACE_TARGET.max,
        fillerHigh: (me.fillerPerMin ?? 0) > FILLER_TARGET_PER_MIN,
      });
      for (const moment of analytics.moments ?? []) {
        if (moment.speaker === self && moments.length < 40) {
          moments.push({ ...moment, meetingId: meeting._id, title: meeting.title });
        }
      }
    }

    // Talk-time-weighted averages (a 2-hour call counts more than a 5-minute one).
    const totalTalk = rows.reduce((sum, r) => sum + r.talkSec, 0);
    const weighted = (pick: (r: CoachingRow) => number | null) => {
      const usable = rows.filter((r) => pick(r) !== null);
      const weight = usable.reduce((sum, r) => sum + r.talkSec, 0);
      return weight > 0 ? usable.reduce((sum, r) => sum + pick(r)! * r.talkSec, 0) / weight : null;
    };
    return {
      meetings: rows,
      moments,
      unidentified,
      averages:
        rows.length === 0
          ? null
          : {
              wpm: Math.round(weighted((r) => r.wpm) ?? 0),
              fillerPerMin: weighted((r) => r.fillerPerMin),
              share: weighted((r) => r.share) ?? 0,
              questionsPerMeeting: rows.reduce((sum, r) => sum + r.questions, 0) / rows.length,
              longestMonologueSec: Math.max(...rows.map((r) => r.longestMonologueSec)),
              talkSec: totalTalk,
            },
    };
  },
});

/** "This is me" on a meeting — remembered as an alias for future meetings. */
export const setSelfSpeaker = mutation({
  args: { meetingId: v.id("meetings"), name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const meeting = await ctx.db.get(args.meetingId);
    if (!workspace || !meeting || meeting.workspaceId !== workspace._id) {
      throw new Error("Meeting not found");
    }
    const analytics = meeting.analytics as MeetingAnalytics | undefined;
    const name = args.name.trim();
    if (!analytics?.speakers.some((s) => s.name === name)) throw new Error("Unknown speaker");
    await ctx.db.patch(args.meetingId, { selfSpeaker: name });
    // Generic labels ("Speaker 2") differ per recording — don't remember those.
    if (/^speaker\s*\d*$/i.test(name)) return;
    const aliases = await ctx.db
      .query("noteSpeakerAliases")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(50);
    if (!aliases.some((a) => normalise(a.name) === normalise(name)) && aliases.length < 50) {
      await ctx.db.insert("noteSpeakerAliases", {
        userId: user._id,
        workspaceId: workspace._id,
        name,
      });
    }
  },
});

/**
 * One-off: recompute analytics (filler words + coaching moments) for
 * meetings analysed before they existed. Run until `remaining: false`:
 *   node node_modules/convex/bin/main.js run noteTakerCoaching:backfillAnalytics
 */
export const backfillAnalytics = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("meetings")
      .paginate({ cursor: args.cursor ?? null, numItems: 25 });
    let updated = 0;
    for (const meeting of page.page) {
      const analytics = meeting.analytics as MeetingAnalytics | undefined;
      if (!meeting.finalizedAt || !analytics || analytics.moments !== undefined) continue;
      const parts = await ctx.db
        .query("meetingTranscriptParts")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .collect();
      const segments = parts.flatMap((p) => p.segments);
      if (segments.length === 0) continue;
      await ctx.db.patch(meeting._id, { analytics: computeAnalytics(segments) });
      updated++;
    }
    return { updated, cursor: page.continueCursor, remaining: !page.isDone };
  },
});
