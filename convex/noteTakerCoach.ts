import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser, getPrimaryWorkspace, requireUser } from "./lib/auth";
import {
  recallConfigured,
  sendChatMessage,
  startOutputMedia,
  stopOutputMedia,
} from "./lib/recall";
import {
  ACTIVE_STATUSES,
  COACH_CHAT_PLATFORMS,
  COACH_TILE_PLATFORMS,
  type CoachState,
} from "../lib/note-taker";

/**
 * Agenda Coach — data layer. Recall streams transcript segments to
 * /notes/realtime during the call; a scheduled tick (noteTakerCoachAi)
 * compares them with the agenda and writes a verdict onto the meeting.
 * Nudges reach the private panel, the meeting chat (bot message) and the
 * public coach card the bot shows as its camera.
 */

export const agendaValidator = v.array(
  v.object({ title: v.string(), minutes: v.number() }),
);

export function emptyCoachState(): CoachState {
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

/** Secret path/query token: the realtime webhook and the coach card use it. */
export function newCoachToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return token;
}

async function callerMeeting(ctx: QueryCtx, meetingId: Id<"meetings">) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  const workspace = await getPrimaryWorkspace(ctx, user._id);
  if (!workspace) return null;
  const meeting = await ctx.db.get(meetingId);
  if (!meeting || meeting.workspaceId !== workspace._id) return null;
  return { user, workspace, meeting };
}

async function coachSettings(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const row = await ctx.db
    .query("noteTakerSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
  return {
    enabled: row?.coachEnabled ?? false,
    chat: row?.coachChat ?? true,
    tile: row?.coachTile ?? false,
    nudgeMin: row?.coachNudgeMin ?? 3,
  };
}

function lightCoachMeeting(meeting: Doc<"meetings">) {
  const state = meeting.coachState as CoachState | undefined;
  return {
    _id: meeting._id,
    title: meeting.title,
    status: meeting.status,
    platform: meeting.platform ?? null,
    scheduledFor: meeting.scheduledFor ?? null,
    startedAt: meeting.startedAt ?? null,
    agenda: meeting.agenda ?? [],
    hasBot: Boolean(meeting.recallBotId),
    tileOn: state?.tileOn ?? false,
    currentItem: state?.currentItem ?? null,
    nudge: state?.nudge ?? null,
    chatSupported: COACH_CHAT_PLATFORMS.includes(meeting.platform ?? ""),
    tileSupported: COACH_TILE_PLATFORMS.includes(meeting.platform ?? ""),
  };
}

// ── Internal: the realtime feed and the tick ────────────────────────────

export const ensureToken = internalMutation({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<string | null> => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return null;
    if (meeting.coachToken) return meeting.coachToken;
    const token = newCoachToken();
    await ctx.db.patch(args.meetingId, { coachToken: token });
    return token;
  },
});

/** One transcript segment from Recall's realtime webhook. */
export const ingestRealtime = internalMutation({
  args: {
    token: v.string(),
    botId: v.optional(v.string()),
    speaker: v.string(),
    start: v.number(),
    end: v.number(),
    text: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ meetingId: Id<"meetings">; scheduleTick: boolean } | null> => {
    const meeting = await ctx.db
      .query("meetings")
      .withIndex("by_coach_token", (q) => q.eq("coachToken", args.token))
      .unique();
    if (!meeting) return null;
    if (args.botId && meeting.recallBotId && args.botId !== meeting.recallBotId) return null;
    if (!args.text.trim()) return { meetingId: meeting._id, scheduleTick: false };
    await ctx.db.insert("meetingLiveSegments", {
      meetingId: meeting._id,
      workspaceId: meeting.workspaceId,
      speaker: args.speaker.slice(0, 80),
      start: args.start,
      end: args.end,
      text: args.text.slice(0, 2000),
    });
    const state = (meeting.coachState as CoachState | undefined) ?? emptyCoachState();
    if (state.tickScheduled) return { meetingId: meeting._id, scheduleTick: false };
    await ctx.db.patch(meeting._id, {
      coachState: { ...state, tickScheduled: true },
      ...(meeting.status !== "recording" &&
        (ACTIVE_STATUSES as string[]).includes(meeting.status) && {
          status: "recording" as const,
          startedAt: meeting.startedAt ?? Date.now(),
        }),
    });
    return { meetingId: meeting._id, scheduleTick: true };
  },
});

export const getCoachContext = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return null;
    const settings = await coachSettings(ctx, meeting.workspaceId);
    const segments = await ctx.db
      .query("meetingLiveSegments")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();
    const talkSec = new Map<string, number>();
    let lastEnd = 0;
    for (const s of segments) {
      talkSec.set(s.speaker, (talkSec.get(s.speaker) ?? 0) + Math.max(0, s.end - s.start));
      if (s.end > lastEnd) lastEnd = s.end;
    }
    const total = [...talkSec.values()].reduce((a, b) => a + b, 0);
    const talk = [...talkSec.entries()]
      .map(([name, sec]) => ({ name, sec, share: total > 0 ? sec / total : 0 }))
      .sort((a, b) => b.sec - a.sec);
    return {
      meeting,
      settings,
      recent: segments.slice(-60).map((s) => ({
        speaker: s.speaker,
        start: s.start,
        text: s.text,
      })),
      talk,
      totalTalkSec: total,
      segmentCount: segments.length,
      lastEnd,
    };
  },
});

export const saveCoachState = internalMutation({
  args: { meetingId: v.id("meetings"), coachState: v.any() },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return;
    await ctx.db.patch(args.meetingId, { coachState: args.coachState });
  },
});

export const logEvent = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    kind: v.union(
      v.literal("overrun"),
      v.literal("drift"),
      v.literal("balance"),
      v.literal("next"),
      v.literal("manual"),
      v.literal("tile"),
    ),
    message: v.string(),
    channels: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return;
    await ctx.db.insert("coachEvents", {
      meetingId: args.meetingId,
      workspaceId: meeting.workspaceId,
      at: Date.now(),
      kind: args.kind,
      message: args.message.slice(0, 500),
      channels: args.channels,
    });
  },
});

/** Auth-checked read for the actions the user triggers on one meeting. */
export const ownMeetingForAction = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const own = await callerMeeting(ctx, args.meetingId);
    if (!own) return null;
    return {
      meeting: own.meeting,
      settings: await coachSettings(ctx, own.workspace._id),
    };
  },
});

// ── Public ──────────────────────────────────────────────────────────────

/** The coach card the bot shows as its camera. Token-gated, no sign-in. */
export const coachCard = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (args.token.length < 16) return null;
    const meeting = await ctx.db
      .query("meetings")
      .withIndex("by_coach_token", (q) => q.eq("coachToken", args.token))
      .unique();
    if (!meeting) return null;
    const row = await ctx.db
      .query("noteTakerSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", meeting.workspaceId))
      .first();
    return {
      title: meeting.title,
      status: meeting.status,
      botName: row?.botName ?? "Notetaker",
      agenda: meeting.agenda ?? [],
      coachState: (meeting.coachState as CoachState | undefined) ?? null,
      startedAt: meeting.startedAt ?? null,
    };
  },
});

/** The private live panel in the Agenda Coach tab. */
export const coachLive = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const own = await callerMeeting(ctx, args.meetingId);
    if (!own) return null;
    const { meeting } = own;
    const events = await ctx.db
      .query("coachEvents")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .order("desc")
      .take(30);
    const segments = await ctx.db
      .query("meetingLiveSegments")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .order("desc")
      .take(8);
    return {
      ...lightCoachMeeting(meeting),
      coachState: (meeting.coachState as CoachState | undefined) ?? null,
      events: events.map((e) => ({
        _id: e._id,
        at: e.at,
        kind: e.kind,
        message: e.message,
        channels: e.channels,
      })),
      recent: segments.reverse().map((s) => ({ speaker: s.speaker, start: s.start, text: s.text })),
      settings: await coachSettings(ctx, own.workspace._id),
    };
  },
});

/** Scheduled + in-flight meetings with their agenda state. */
export const listCoachMeetings = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    const recent = await ctx.db
      .query("meetings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(200);
    return recent
      .filter(
        (m) =>
          m.status === "scheduled" || (ACTIVE_STATUSES as string[]).includes(m.status),
      )
      .sort(
        (a, b) =>
          (a.scheduledFor ?? a._creationTime) - (b.scheduledFor ?? b._creationTime),
      )
      .map(lightCoachMeeting);
  },
});

export const setAgenda = mutation({
  args: { meetingId: v.id("meetings"), agenda: agendaValidator },
  handler: async (ctx, args) => {
    const own = await callerMeeting(ctx, args.meetingId);
    if (!own) throw new Error("Meeting not found");
    if (args.agenda.length > 20) throw new Error("Up to 20 agenda items");
    const agenda = args.agenda
      .map((item) => ({
        title: item.title.trim().slice(0, 120),
        minutes: Math.min(180, Math.max(1, Math.round(item.minutes))),
      }))
      .filter((item) => item.title);
    await ctx.db.patch(args.meetingId, {
      agenda,
      ...(!own.meeting.coachToken && { coachToken: newCoachToken() }),
    });
  },
});

export const saveCoachSettings = mutation({
  args: {
    coachEnabled: v.boolean(),
    coachChat: v.boolean(),
    coachTile: v.boolean(),
    coachNudgeMin: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const patch = {
      coachEnabled: args.coachEnabled,
      coachChat: args.coachChat,
      coachTile: args.coachTile,
      coachNudgeMin: Math.min(30, Math.max(1, Math.round(args.coachNudgeMin))),
    };
    const row = await ctx.db
      .query("noteTakerSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .first();
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("noteTakerSettings", { workspaceId: workspace._id, ...patch });
  },
});

/** Finished meetings and where their action items went. */
export const recentRouting = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    const recent = await ctx.db
      .query("meetings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(60);
    return recent
      .filter((m) => m.status === "done" && m.notesStatus === "ready")
      .slice(0, 12)
      .map((m) => {
        const notes = m.notes as { actionItems?: unknown[] } | undefined;
        return {
          _id: m._id,
          title: m.title,
          endedAt: m.endedAt ?? m._creationTime,
          actionItemCount: notes?.actionItems?.length ?? 0,
          taskRouting: (m.taskRouting as unknown) ?? null,
        };
      });
  },
});

// ── Actions (fetch only — default runtime) ──────────────────────────────

/** Post a nudge into the meeting chat right now. */
export const postNudge = action({
  args: { meetingId: v.id("meetings"), message: v.string() },
  handler: async (ctx, args): Promise<void> => {
    if (!recallConfigured()) throw new Error("NOT_CONFIGURED: the note taker is not switched on");
    const own = await ctx.runQuery(internal.noteTakerCoach.ownMeetingForAction, {
      meetingId: args.meetingId,
    });
    if (!own) throw new Error("Meeting not found");
    const { meeting } = own;
    const message = args.message.trim().slice(0, 500);
    if (!message) throw new Error("Write the message first");
    if (!meeting.recallBotId || !["recording", "joining", "waiting_room"].includes(meeting.status)) {
      throw new Error("The bot is not in a call right now");
    }
    if (!COACH_CHAT_PLATFORMS.includes(meeting.platform ?? "")) {
      throw new Error("This platform does not let bots post in chat");
    }
    await sendChatMessage(meeting.recallBotId, message);
    await ctx.runMutation(internal.noteTakerCoach.logEvent, {
      meetingId: args.meetingId,
      kind: "manual",
      message,
      channels: ["chat"],
    });
  },
});

/** Show or hide the coach card as the bot's camera on a live call. */
export const setTile = action({
  args: { meetingId: v.id("meetings"), on: v.boolean() },
  handler: async (ctx, args): Promise<void> => {
    if (!recallConfigured()) throw new Error("NOT_CONFIGURED: the note taker is not switched on");
    const own = await ctx.runQuery(internal.noteTakerCoach.ownMeetingForAction, {
      meetingId: args.meetingId,
    });
    if (!own) throw new Error("Meeting not found");
    const { meeting } = own;
    if (!meeting.recallBotId || !["recording", "joining", "waiting_room"].includes(meeting.status)) {
      throw new Error("The bot is not in a call right now");
    }
    if (!COACH_TILE_PLATFORMS.includes(meeting.platform ?? "")) {
      throw new Error("This platform does not support a bot camera feed");
    }
    const appUrl = process.env.APP_URL?.replace(/\/$/, "");
    if (args.on) {
      if (!appUrl) throw new Error("NOT_CONFIGURED: APP_URL is not set, so the coach card has no public address");
      const token =
        meeting.coachToken ??
        (await ctx.runMutation(internal.noteTakerCoach.ensureToken, { meetingId: args.meetingId }));
      await startOutputMedia(meeting.recallBotId, `${appUrl}/coach/${token}`);
    } else {
      await stopOutputMedia(meeting.recallBotId);
    }
    const state = (meeting.coachState as CoachState | undefined) ?? emptyCoachState();
    await ctx.runMutation(internal.noteTakerCoach.saveCoachState, {
      meetingId: args.meetingId,
      coachState: { ...state, tileOn: args.on, updatedAt: Date.now() },
    });
    await ctx.runMutation(internal.noteTakerCoach.logEvent, {
      meetingId: args.meetingId,
      kind: "tile",
      message: args.on ? "Coach card shown as the bot camera" : "Coach card hidden",
      channels: ["tile"],
    });
  },
});
