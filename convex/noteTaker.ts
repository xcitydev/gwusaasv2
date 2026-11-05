import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type QueryCtx,
} from "./_generated/server";
import { publicRowError } from "./incidents";
import { internal } from "./_generated/api";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { spendCredits } from "./lib/credits";
import { getConfigValue } from "./config";
import { meetingStatusValidator } from "./schema";
import { flattenTranscript, snippetAround, type Segment } from "./lib/transcript";
import { ACTIVE_STATUSES } from "../lib/note-taker";
import { newCoachToken, newRealtimeToken } from "./noteTakerCoach";
import { secureToken } from "./lib/tokens";

/**
 * AI Note Taker — data layer. A `meetings` row follows one bot through its
 * life (scheduled → joining → recording → processing → done); the heavy
 * transcript lives in `meetingTranscriptParts` so lists stay light.
 */

/** A bot is only sent when the workspace can pay for at least this much. */
export const MIN_BILLABLE_MINUTES = 10;
/** Hard ceiling on one recording, whatever the balance. */
export const MAX_MEETING_MINUTES = 240;

const SETTINGS_DEFAULTS = {
  recapAudience: "host" as const,
  retentionDays: 30,
  autoJoin: "manual" as const,
};

/**
 * The bot's display name always ends in "Notetaker" so it can never pass for
 * a real participant ("Dana Smith" → "Dana Smith Notetaker").
 */
export function botDisplayName(raw: string | undefined, workspaceName: string): string {
  // "Dana's workspace" → "Dana's Notetaker", "Acme" → "Acme Notetaker".
  const owner = workspaceName.replace(/['’]s workspace$/i, "’s").trim();
  const base = (raw?.trim() || owner || "AI")
    .replace(/\s*(note[\s-]*taker|bot)\s*$/i, "")
    .trim()
    .slice(0, 80);
  return `${base || owner || "AI"} Notetaker`;
}

function resolveSettings(
  row: Doc<"noteTakerSettings"> | null,
  workspaceName: string,
) {
  return {
    botName: botDisplayName(row?.botName, workspaceName),
    // The recording disclosure is mandatory (consent laws), not a toggle —
    // a stored `announce: false` from before is ignored.
    announce: true as const,
    recapAudience: row?.recapAudience ?? SETTINGS_DEFAULTS.recapAudience,
    recapExtraEmails: row?.recapExtraEmails ?? [],
    retentionDays: row?.retentionDays ?? SETTINGS_DEFAULTS.retentionDays,
    autoJoin: row?.autoJoin ?? SETTINGS_DEFAULTS.autoJoin,
    calcomToken: row?.calcomToken ?? null,
    calcomSecret: row?.calcomSecret ?? null,
    calcomSecretVerified: row?.calcomSecretVerified ?? false,
    // Agenda Coach (live nudges) — off until the workspace switches it on.
    coachEnabled: row?.coachEnabled ?? false,
    coachChat: row?.coachChat ?? true,
    coachTile: row?.coachTile ?? false,
    coachNudgeMin: row?.coachNudgeMin ?? 3,
  };
}

async function settingsRow(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  return await ctx.db
    .query("noteTakerSettings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
}

async function callerWorkspace(ctx: QueryCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  const workspace = await getPrimaryWorkspace(ctx, user._id);
  if (!workspace) return null;
  return { user, workspace };
}

async function ownMeeting(ctx: QueryCtx, meetingId: Id<"meetings">) {
  const caller = await callerWorkspace(ctx);
  const meeting = await ctx.db.get(meetingId);
  if (!caller || !meeting || meeting.workspaceId !== caller.workspace._id) {
    return null;
  }
  return { ...caller, meeting };
}

/** List rows without the heavy AI payload. */
function lightMeeting(meeting: Doc<"meetings">) {
  const { notes, analytics, searchText, ...rest } = meeting;
  void analytics;
  void searchText;
  const summary =
    notes && typeof notes.summary === "string"
      ? (notes.summary as string).slice(0, 240)
      : null;
  const actionItemCount =
    notes && Array.isArray(notes.actionItems) ? notes.actionItems.length : 0;
  return { ...rest, summary, actionItemCount };
}

// ── Public: overview + settings ─────────────────────────────────────────

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const caller = await callerWorkspace(ctx);
    if (!caller) return null;
    const { user, workspace } = caller;
    const row = await settingsRow(ctx, workspace._id);
    const settings = resolveSettings(row, workspace.name);
    const calendars = await ctx.db
      .query("noteTakerCalendars")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const creditsPerMinute = await getConfigValue(
      ctx,
      "noteTakerCreditsPerMinute",
    );
    const site = process.env.CONVEX_SITE_URL ?? "";
    return {
      configured: Boolean(process.env.RECALL_API_KEY),
      emailConfigured: Boolean(process.env.RESEND_API_KEY),
      calendarProviders: {
        google: Boolean(
          process.env.GOOGLE_OAUTH_CLIENT_ID &&
            process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        ),
        microsoft: Boolean(
          process.env.MS_OAUTH_CLIENT_ID && process.env.MS_OAUTH_CLIENT_SECRET,
        ),
      },
      isAdmin: Boolean(user.adminRole),
      webhookUrl: site ? `${site}/notes/recall-webhook` : null,
      // Agenda Coach needs the app's public address for the bot camera card.
      appUrlConfigured: Boolean(process.env.APP_URL),
      credits: workspace.credits,
      creditsPerMinute,
      minCredits: creditsPerMinute * MIN_BILLABLE_MINUTES,
      settings,
      calcomWebhookUrl:
        site && settings.calcomToken
          ? `${site}/notes/calcom/${settings.calcomToken}`
          : null,
      calendars: calendars.map((c) => ({
        _id: c._id,
        platform: c.platform,
        email: c.email ?? null,
        status: c.status,
      })),
    };
  },
});

export const saveSettings = mutation({
  args: {
    botName: v.string(),
    // Ignored: the recording announcement is always on. Optional so older
    // clients still validate.
    announce: v.optional(v.boolean()),
    recapAudience: v.union(
      v.literal("host"),
      v.literal("attendees"),
      v.literal("none"),
    ),
    recapExtraEmails: v.array(v.string()),
    retentionDays: v.number(),
    autoJoin: v.union(v.literal("all"), v.literal("manual")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const emails = args.recapExtraEmails
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const bad = emails.find((e) => !/^\S+@\S+\.\S+$/.test(e));
    if (bad) throw new Error(`"${bad}" isn't a valid email`);
    if (emails.length > 10) throw new Error("Up to 10 extra recipients");
    const patch = {
      botName: args.botName.trim().slice(0, 100) || undefined,
      recapAudience: args.recapAudience,
      recapExtraEmails: emails,
      retentionDays: Math.min(365, Math.max(1, Math.round(args.retentionDays))),
      autoJoin: args.autoJoin,
    };
    const row = await settingsRow(ctx, workspace._id);
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("noteTakerSettings", { workspaceId: workspace._id, ...patch });
  },
});

/**
 * Mint (or rotate) the secret path token for the Cal.com webhook, plus the
 * signing secret the user pastes into Cal.com's "Secret" field. Signatures
 * are enforced from the first correctly signed delivery onwards.
 */
export const rotateCalcomToken = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const patch = {
      calcomToken: secureToken(40),
      calcomSecret: secureToken(40),
      calcomSecretVerified: false,
    };
    const row = await settingsRow(ctx, workspace._id);
    if (row) await ctx.db.patch(row._id, patch);
    else {
      await ctx.db.insert("noteTakerSettings", {
        workspaceId: workspace._id,
        ...patch,
      });
    }
    return patch.calcomToken;
  },
});

/** First validly signed Cal.com delivery: from now on unsigned ones drop. */
export const markCalcomSecretVerified = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const row = await settingsRow(ctx, args.workspaceId);
    if (row && !row.calcomSecretVerified) {
      await ctx.db.patch(row._id, { calcomSecretVerified: true });
    }
  },
});

// ── Public: meetings ────────────────────────────────────────────────────

export const listMeetings = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const caller = await callerWorkspace(ctx);
    if (!caller) {
      return {
        page: [] as ReturnType<typeof lightMeeting>[],
        isDone: true,
        continueCursor: "",
      };
    }
    const result = await ctx.db
      .query("meetings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", caller.workspace._id))
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(lightMeeting) };
  },
});

/** Bots in flight + what is scheduled next — the live strip up top. */
export const liveMeetings = query({
  args: {},
  handler: async (ctx) => {
    const caller = await callerWorkspace(ctx);
    if (!caller) return [];
    const recent = await ctx.db
      .query("meetings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", caller.workspace._id))
      .order("desc")
      .take(200);
    return recent
      .filter(
        (m) =>
          m.status === "scheduled" ||
          (ACTIVE_STATUSES as string[]).includes(m.status),
      )
      .sort(
        (a, b) =>
          (a.scheduledFor ?? a._creationTime) - (b.scheduledFor ?? b._creationTime),
      )
      .map(lightMeeting);
  },
});

export const getMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const own = await ownMeeting(ctx, args.meetingId);
    if (!own) return null;
    const { searchText, ...meeting } = own.meeting;
    void searchText;
    return meeting;
  },
});

async function loadSegments(
  ctx: QueryCtx,
  meetingId: Id<"meetings">,
): Promise<Segment[]> {
  const parts = await ctx.db
    .query("meetingTranscriptParts")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  return parts.flatMap((part) => part.segments);
}

export const getTranscript = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<Segment[]> => {
    const own = await ownMeeting(ctx, args.meetingId);
    if (!own) return [];
    return await loadSegments(ctx, args.meetingId);
  },
});

/**
 * Search every meeting: titles + AI notes (search_meta) and the spoken
 * words themselves (search_text on transcript parts) — transcript hits
 * come back with the moment they were said.
 */
export const searchMeetings = query({
  args: { q: v.string() },
  handler: async (ctx, args) => {
    const term = args.q.trim();
    const caller = await callerWorkspace(ctx);
    if (!caller || term.length < 2) return [];
    const workspaceId = caller.workspace._id;
    const metaHits = await ctx.db
      .query("meetings")
      .withSearchIndex("search_meta", (q) =>
        q.search("searchText", term).eq("workspaceId", workspaceId),
      )
      .take(15);
    const partHits = await ctx.db
      .query("meetingTranscriptParts")
      .withSearchIndex("search_text", (q) =>
        q.search("text", term).eq("workspaceId", workspaceId),
      )
      .take(30);
    const results = new Map<
      Id<"meetings">,
      {
        meeting: ReturnType<typeof lightMeeting>;
        snippet: string | null;
        atSec: number | null;
      }
    >();
    for (const meeting of metaHits) {
      results.set(meeting._id, {
        meeting: lightMeeting(meeting),
        snippet: null,
        atSec: null,
      });
    }
    const needle = term.split(/\s+/)[0].toLowerCase();
    for (const part of partHits) {
      const existing = results.get(part.meetingId);
      if (existing?.snippet) continue;
      const meeting = existing
        ? null
        : await ctx.db.get(part.meetingId);
      if (!existing && !meeting) continue;
      const hit =
        part.segments.find((s) => s.text.toLowerCase().includes(needle)) ??
        part.segments[0];
      results.set(part.meetingId, {
        meeting: existing?.meeting ?? lightMeeting(meeting!),
        snippet: hit ? `${hit.speaker}: ${snippetAround(hit.text, term)}` : null,
        atSec: hit ? hit.start : null,
      });
    }
    return [...results.values()]
      .sort((a, b) => b.meeting._creationTime - a.meeting._creationTime)
      .slice(0, 30);
  },
});

export const listChat = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const own = await ownMeeting(ctx, args.meetingId);
    if (!own) return [];
    return await ctx.db
      .query("meetingChats")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .order("asc")
      .take(200);
  },
});

export const renameMeeting = mutation({
  args: { meetingId: v.id("meetings"), title: v.string() },
  handler: async (ctx, args) => {
    const own = await ownMeeting(ctx, args.meetingId);
    if (!own) throw new Error("Meeting not found");
    const title = args.title.trim().slice(0, 140);
    if (!title) throw new Error("Give the meeting a title");
    await ctx.db.patch(args.meetingId, { title, autoTitle: false });
  },
});

/** Remove a meeting everywhere: our rows now, Recall's media right after. */
export const deleteMeeting = mutation({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const own = await ownMeeting(ctx, args.meetingId);
    if (!own) throw new Error("Meeting not found");
    const { meeting } = own;
    if (meeting.recallBotId) {
      const live =
        meeting.status === "scheduled" ||
        (ACTIVE_STATUSES as string[]).includes(meeting.status);
      await ctx.scheduler.runAfter(0, internal.noteTakerActions.retireBot, {
        botId: meeting.recallBotId,
        recallEventId: meeting.recallEventId,
        wasLive: live,
        wasScheduled: meeting.status === "scheduled",
      });
    }
    const parts = await ctx.db
      .query("meetingTranscriptParts")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();
    for (const part of parts) await ctx.db.delete(part._id);
    const chats = await ctx.db
      .query("meetingChats")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();
    for (const chat of chats) await ctx.db.delete(chat._id);
    await ctx.db.delete(args.meetingId);
  },
});

// ── Internal: creation ──────────────────────────────────────────────────

const attendeesValidator = v.array(
  v.object({ name: v.string(), email: v.optional(v.string()) }),
);

/** A signed-in user sends a bot (now, or at a time). */
export const createMeeting = internalMutation({
  args: {
    meetingUrl: v.string(),
    title: v.optional(v.string()),
    platform: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"meetings">> => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const rate = await getConfigValue(ctx, "noteTakerCreditsPerMinute");
    // Every bot already lined up claims its minimum too — the balance has
    // to cover all of them, not just this one.
    const committed = await liveBotCount(ctx, workspace._id);
    const minimum = rate * MIN_BILLABLE_MINUTES * (committed + 1);
    if (workspace.credits < minimum) {
      throw new Error(
        `INSUFFICIENT_CREDITS: need ${Math.ceil(minimum)}, have ${Math.floor(workspace.credits)}`,
      );
    }
    const title = args.title?.trim().slice(0, 140);
    return await ctx.db.insert("meetings", {
      workspaceId: workspace._id,
      userId: user._id,
      title: title || "Untitled meeting",
      autoTitle: !title,
      meetingUrl: args.meetingUrl,
      platform: args.platform,
      source: "manual",
      status: args.scheduledFor ? "scheduled" : "joining",
      scheduledFor: args.scheduledFor,
      coachToken: newCoachToken(),
      realtimeToken: newRealtimeToken(),
    });
  },
});

/** Calendar / Cal.com paths — no signed-in user; one row per real meeting. */
export const upsertSystemMeeting = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    dedupKey: v.string(),
    source: v.union(v.literal("calendar"), v.literal("calcom")),
    meetingUrl: v.string(),
    platform: v.optional(v.string()),
    title: v.optional(v.string()),
    scheduledFor: v.number(),
    attendees: v.optional(attendeesValidator),
    calendarId: v.optional(v.id("noteTakerCalendars")),
    recallEventId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"meetings">> => {
    const existing = await ctx.db
      .query("meetings")
      .withIndex("by_dedup", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("dedupKey", args.dedupKey),
      )
      .first();
    const title = args.title?.trim().slice(0, 140);
    if (existing) {
      await ctx.db.patch(existing._id, {
        meetingUrl: args.meetingUrl,
        platform: args.platform,
        scheduledFor: args.scheduledFor,
        ...(title && { title, autoTitle: false }),
        ...(args.attendees && { attendees: args.attendees }),
        ...(existing.status === "cancelled" && {
          status: "scheduled" as const,
          statusDetail: undefined,
        }),
      });
      return existing._id;
    }
    return await ctx.db.insert("meetings", {
      workspaceId: args.workspaceId,
      userId: args.userId,
      title: title || "Untitled meeting",
      autoTitle: !title,
      meetingUrl: args.meetingUrl,
      platform: args.platform,
      source: args.source,
      dedupKey: args.dedupKey,
      calendarId: args.calendarId,
      recallEventId: args.recallEventId,
      status: "scheduled",
      scheduledFor: args.scheduledFor,
      attendees: args.attendees,
      coachToken: newCoachToken(),
      realtimeToken: newRealtimeToken(),
    });
  },
});

// ── Internal: lifecycle reads/writes ────────────────────────────────────

/** Bots scheduled or in a call for a workspace (optionally minus one). */
async function liveBotCount(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  exclude?: Id<"meetings">,
): Promise<number> {
  const recent = await ctx.db
    .query("meetings")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .order("desc")
    .take(200);
  return recent.filter(
    (m) =>
      m._id !== exclude &&
      !m.finalizedAt &&
      (m.status === "scheduled" || (ACTIVE_STATUSES as string[]).includes(m.status)),
  ).length;
}

/** Everything needed to configure and dispatch a bot for a meeting. */
export const getDispatchInfo = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return null;
    const workspace = await ctx.db.get(meeting.workspaceId);
    if (!workspace) return null;
    const settings = resolveSettings(
      await settingsRow(ctx, meeting.workspaceId),
      workspace.name,
    );
    const rate = await getConfigValue(ctx, "noteTakerCreditsPerMinute");
    const affordableMinutes =
      rate > 0 ? Math.floor(workspace.credits / rate) : MAX_MEETING_MINUTES;
    const others = await liveBotCount(ctx, meeting.workspaceId, meeting._id);
    const host = await ctx.db.get(meeting.userId);
    return {
      meeting,
      settings,
      // Named in the recording announcement ("…on behalf of Dana Smith").
      hostName: host?.name?.trim() || host?.email || workspace.name,
      credits: workspace.credits,
      // This bot's minimum on top of every other bot already lined up
      // (calendar auto-join can stack many against one balance).
      canAfford: workspace.credits >= rate * MIN_BILLABLE_MINUTES * (others + 1),
      maxRecordingSec:
        Math.min(MAX_MEETING_MINUTES, Math.max(MIN_BILLABLE_MINUTES, affordableMinutes)) *
        60,
    };
  },
});

/** Live balance check while a bot records (pollMeeting stops it at zero). */
export const getRecordingBudget = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return null;
    const workspace = await ctx.db.get(meeting.workspaceId);
    const rate = await getConfigValue(ctx, "noteTakerCreditsPerMinute");
    return { credits: workspace?.credits ?? 0, rate };
  },
});

export const getMeetingInternal = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => await ctx.db.get(args.meetingId),
});

/** Auth-checked read for actions the user triggers on one meeting. */
export const getOwnMeeting = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const own = await ownMeeting(ctx, args.meetingId);
    return own?.meeting ?? null;
  },
});

export const getByBot = internalQuery({
  args: { recallBotId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("meetings")
      .withIndex("by_bot", (q) => q.eq("recallBotId", args.recallBotId))
      .first(),
});

export const getByDedup = internalQuery({
  args: { workspaceId: v.id("workspaces"), dedupKey: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("meetings")
      .withIndex("by_dedup", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("dedupKey", args.dedupKey),
      )
      .first(),
});

export const patchMeeting = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    status: v.optional(meetingStatusValidator),
    statusDetail: v.optional(v.string()),
    clearStatusDetail: v.optional(v.boolean()),
    recallBotId: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    dispatchAttempts: v.optional(v.number()),
    pollCount: v.optional(v.number()),
    mediaDeleted: v.optional(v.boolean()),
    notesStatus: v.optional(
      v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    ),
    recapSentAt: v.optional(v.number()),
  },
  handler: async (ctx, { meetingId, clearStatusDetail, ...patch }) => {
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) return;
    if (patch.statusDetail) {
      patch.statusDetail = await publicRowError(ctx, patch.statusDetail, {
        source: "note taker bot",
        area: "meetings",
        userId: meeting.userId,
        workspaceId: meeting.workspaceId,
      });
    }
    await ctx.db.patch(meetingId, {
      ...patch,
      ...(clearStatusDetail && { statusDetail: undefined }),
    });
  },
});

/**
 * The recording is in: store the transcript (chunked), talk-time analytics
 * and who was there, then bill by the started minute. Idempotent — a second
 * call (webhook + poll racing) is a no-op.
 */
export const storeRecording = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    durationSec: v.number(),
    platformTitle: v.optional(v.string()),
    attendees: attendeesValidator,
    analytics: v.any(),
    parts: v.array(
      v.array(
        v.object({
          speaker: v.string(),
          start: v.number(),
          end: v.number(),
          text: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args): Promise<{ stored: boolean; credits: number }> => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting || meeting.finalizedAt) return { stored: false, credits: 0 };

    for (const [index, segments] of args.parts.entries()) {
      await ctx.db.insert("meetingTranscriptParts", {
        meetingId: args.meetingId,
        workspaceId: meeting.workspaceId,
        part: index,
        segments,
        text: segments.map((s) => `${s.speaker}: ${s.text}`).join("\n"),
      });
    }

    // Keep invitee emails from the calendar; add whoever actually spoke.
    const attendees = [...(meeting.attendees ?? [])];
    for (const person of args.attendees) {
      const known = attendees.find(
        (a) => a.name.toLowerCase() === person.name.toLowerCase(),
      );
      if (!known) attendees.push(person);
      else if (person.email && !known.email) known.email = person.email;
    }

    // Bill per started minute; never more than the balance holds.
    const rate = await getConfigValue(ctx, "noteTakerCreditsPerMinute");
    const workspace = await ctx.db.get(meeting.workspaceId);
    const owed = Math.ceil(args.durationSec / 60) * rate;
    const credits = Math.min(owed, workspace?.credits ?? 0);
    if (credits > 0) {
      await spendCredits(ctx, {
        workspaceId: meeting.workspaceId,
        amount: credits,
        feature: "note_taker",
        description: `Meeting notes — ${Math.ceil(args.durationSec / 60)} min`,
        userId: meeting.userId,
        meta: { meetingId: args.meetingId },
      });
    }

    const useTitle = meeting.autoTitle && args.platformTitle?.trim();
    await ctx.db.patch(args.meetingId, {
      ...(useTitle && { title: args.platformTitle!.trim().slice(0, 140) }),
      startedAt: args.startedAt ?? meeting.startedAt,
      endedAt: args.endedAt,
      durationSec: args.durationSec,
      attendees,
      analytics: args.analytics,
      costCredits: credits,
      finalizedAt: Date.now(),
      status: "processing",
      statusDetail: undefined,
      notesStatus: "pending",
    });
    return { stored: true, credits };
  },
});

/** What the notes pass reads (no identity — it runs from the scheduler). */
export const getNotesContext = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return null;
    const workspace = await ctx.db.get(meeting.workspaceId);
    const host = await ctx.db.get(meeting.userId);
    const settings = resolveSettings(
      await settingsRow(ctx, meeting.workspaceId),
      workspace?.name ?? "",
    );
    const segments = await loadSegments(ctx, args.meetingId);
    return {
      meeting,
      transcript: flattenTranscript(segments),
      settings,
      hostEmail: host?.email ?? null,
      hostName: host?.name ?? null,
    };
  },
});

export const storeNotes = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    notes: v.optional(v.any()),
    failure: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return;
    if (!args.notes) {
      await ctx.db.patch(args.meetingId, {
        status: "done",
        notesStatus: "failed",
        statusDetail: args.failure ?? "Notes could not be generated",
      });
      return;
    }
    const notes = args.notes as {
      title?: string;
      summary?: string;
      keyPoints?: string[];
      decisions?: string[];
      actionItems?: { task?: string }[];
    };
    const title =
      meeting.autoTitle && notes.title?.trim()
        ? notes.title.trim().slice(0, 140)
        : meeting.title;
    await ctx.db.patch(args.meetingId, {
      title,
      notes: args.notes,
      notesStatus: "ready",
      status: "done",
      statusDetail: undefined,
      // What search_meta indexes: title + the written-up substance.
      searchText: [
        title,
        notes.summary ?? "",
        ...(notes.keyPoints ?? []),
        ...(notes.decisions ?? []),
        ...(notes.actionItems ?? []).map((a) => a.task ?? ""),
      ]
        .join("\n")
        .slice(0, 8000),
    });
    // Action items → connected task tools (Trello / Asana / webhook).
    await ctx.scheduler.runAfter(0, internal.integrations.routeActionItems, {
      meetingId: args.meetingId,
    });
  },
});

/** "Email me the recap": the caller's own meeting + where to send it. */
export const getRecapContext = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const own = await ownMeeting(ctx, args.meetingId);
    if (!own) return null;
    return { callerEmail: own.user.email };
  },
});

// ── Internal: Ask AI ────────────────────────────────────────────────────

export const getAskContext = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const own = await ownMeeting(ctx, args.meetingId);
    if (!own) return null;
    const segments = await loadSegments(ctx, args.meetingId);
    const history = await ctx.db
      .query("meetingChats")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .order("desc")
      .take(12);
    return {
      userId: own.user._id,
      workspaceId: own.workspace._id,
      title: own.meeting.title,
      transcript: flattenTranscript(segments),
      history: history.reverse().map((m) => ({ role: m.role, content: m.content })),
    };
  },
});

export const insertChat = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("meetingChats", args);
  },
});

// ── Internal: sweep ─────────────────────────────────────────────────────

/** Meetings a lost poll chain or webhook may have stranded. */
export const listStranded = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"meetings">[]> => {
    const now = Date.now();
    const stranded: Id<"meetings">[] = [];
    for (const status of [...ACTIVE_STATUSES, "scheduled"] as const) {
      const rows = await ctx.db
        .query("meetings")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(200);
      for (const row of rows) {
        if (!row.recallBotId) continue;
        // Scheduled: only once its start time is well past.
        if (status === "scheduled" && (row.scheduledFor ?? 0) > now - 5 * 60_000) {
          continue;
        }
        stranded.push(row._id);
      }
    }
    return stranded;
  },
});

// ── Internal: calendars + OAuth state ───────────────────────────────────

const calendarPlatformValidator = v.union(
  v.literal("google_calendar"),
  v.literal("microsoft_outlook"),
);

export const createOauthState = internalMutation({
  args: { platform: calendarPlatformValidator },
  handler: async (ctx, args): Promise<string> => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const state = secureToken(43);
    await ctx.db.insert("noteTakerOauthStates", {
      state,
      userId: user._id,
      workspaceId: workspace._id,
      platform: args.platform,
    });
    return state;
  },
});

/** One-shot: a state is valid once, for 15 minutes. */
export const consumeOauthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("noteTakerOauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row._creationTime > 15 * 60_000) return null;
    return { userId: row.userId, workspaceId: row.workspaceId, platform: row.platform };
  },
});

/** How long a finished consent waits for its owner to confirm in-app. */
const PENDING_CALENDAR_TTL_MS = 15 * 60_000;

/**
 * Callback side: park the grant under a fresh nonce. Only the browser that
 * finished the consent learns the nonce (it rides the redirect), and only
 * the user who started the flow can claim it — so a consent link forwarded
 * to someone else can't attach THEIR calendar to the sender's account.
 */
export const createPendingCalendar = internalMutation({
  args: {
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    platform: calendarPlatformValidator,
    refreshTokenEncrypted: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    const nonce = secureToken(43);
    await ctx.db.insert("noteTakerPendingCalendars", {
      ...args,
      nonce,
      expiresAt: Date.now() + PENDING_CALENDAR_TTL_MS,
    });
    return nonce;
  },
});

/** Confirm side: one shot, signed-in owner only, inside the TTL. */
export const claimPendingCalendar = internalMutation({
  args: { nonce: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await ctx.db
      .query("noteTakerPendingCalendars")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .first();
    if (!row) return { ok: false as const, reason: "expired" as const };
    // Whatever happens next, a nonce is good for one attempt.
    await ctx.db.delete(row._id);
    if (row.expiresAt < Date.now()) return { ok: false as const, reason: "expired" as const };
    if (row.userId !== user._id) return { ok: false as const, reason: "wrong_user" as const };
    return {
      ok: true as const,
      userId: row.userId,
      workspaceId: row.workspaceId,
      platform: row.platform,
      refreshTokenEncrypted: row.refreshTokenEncrypted,
    };
  },
});

export const insertCalendar = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    platform: calendarPlatformValidator,
    recallCalendarId: v.string(),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"noteTakerCalendars">> =>
    await ctx.db.insert("noteTakerCalendars", { ...args, status: "connected" }),
});

export const getCalendarDoc = internalQuery({
  args: { calendarDocId: v.id("noteTakerCalendars") },
  handler: async (ctx, args) => {
    const calendar = await ctx.db.get(args.calendarDocId);
    if (!calendar) return null;
    const workspace = await ctx.db.get(calendar.workspaceId);
    if (!workspace) return null;
    return {
      calendar,
      settings: resolveSettings(
        await settingsRow(ctx, calendar.workspaceId),
        workspace.name,
      ),
    };
  },
});

export const getCalendarByRecallId = internalQuery({
  args: { recallCalendarId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("noteTakerCalendars")
      .withIndex("by_recall_id", (q) =>
        q.eq("recallCalendarId", args.recallCalendarId),
      )
      .first(),
});

/** The caller's own calendars (auth-checked) — for user-triggered actions. */
export const listOwnCalendars = internalQuery({
  args: {},
  handler: async (ctx) => {
    const caller = await callerWorkspace(ctx);
    if (!caller) return [];
    return await ctx.db
      .query("noteTakerCalendars")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", caller.workspace._id))
      .collect();
  },
});

export const listAllCalendars = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"noteTakerCalendars">[]> => {
    const calendars = await ctx.db.query("noteTakerCalendars").collect();
    return calendars.filter((c) => c.status === "connected").map((c) => c._id);
  },
});

export const patchCalendar = internalMutation({
  args: {
    calendarDocId: v.id("noteTakerCalendars"),
    status: v.optional(v.union(v.literal("connected"), v.literal("disconnected"))),
    lastSyncedTs: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, { calendarDocId, ...patch }) => {
    if (await ctx.db.get(calendarDocId)) await ctx.db.patch(calendarDocId, patch);
  },
});

/** Drop a calendar and cancel the bots it had lined up. */
export const removeCalendar = internalMutation({
  args: { calendarDocId: v.id("noteTakerCalendars") },
  handler: async (ctx, args) => {
    const calendar = await ctx.db.get(args.calendarDocId);
    if (!calendar) return;
    const scheduled = await ctx.db
      .query("meetings")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .take(500);
    for (const meeting of scheduled) {
      if (meeting.calendarId === args.calendarDocId) {
        await ctx.db.patch(meeting._id, {
          status: "cancelled",
          statusDetail: "Calendar disconnected",
        });
      }
    }
    await ctx.db.delete(args.calendarDocId);
  },
});

// ── Internal: Cal.com ───────────────────────────────────────────────────

export const getWorkspaceByCalcomToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("noteTakerSettings")
      .withIndex("by_calcom_token", (q) => q.eq("calcomToken", args.token))
      .first();
    if (!row) return null;
    const workspace = await ctx.db.get(row.workspaceId);
    if (!workspace) return null;
    return {
      workspaceId: workspace._id,
      ownerId: workspace.ownerId,
      calcomSecret: row.calcomSecret ?? null,
      calcomSecretVerified: row.calcomSecretVerified ?? false,
    };
  },
});
