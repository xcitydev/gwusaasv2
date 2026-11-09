import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type MutationCtx,
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
import {
  ACTIVE_STATUSES,
  OUTPUT_LANGUAGES,
  PUBLIC_EMAIL_DOMAINS,
  emailDomain,
  type CoachState,
  type MeetingAnalytics,
  type MeetingNotes,
} from "../lib/note-taker";
import { isMeetingType } from "../lib/meeting-templates";
import { scoreMeeting } from "../lib/meeting-score";

const autoJoinValidator = v.union(
  v.literal("all"),
  v.literal("hosting"),
  v.literal("manual"),
);
import { newCoachToken, newRealtimeToken } from "./noteTakerCoach";
import { secureToken } from "./lib/tokens";
import { claimUpload } from "./files";

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
    // Has anyone chosen an auto-join mode yet? (First calendar connect
    // switches "hosting" on when nobody has.)
    autoJoinChosen: row?.autoJoin !== undefined,
    joinInternalOnly: row?.joinInternalOnly ?? false,
    internalDomains: row?.internalDomains ?? [],
    skipRecurring: row?.skipRecurring ?? false,
    outputLanguage: row?.outputLanguage ?? "auto",
    briefEnabled: row?.briefEnabled ?? true,
    briefLeadMin: row?.briefLeadMin ?? 60,
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
  const { notes, analytics, searchText, scoreBreakdown, brief, coachState, ...rest } =
    meeting;
  void analytics;
  void searchText;
  void scoreBreakdown;
  void brief;
  void coachState;
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
    // Company domains guessed from teammates' logins (free-mail ones left
    // out) — prefills "internal guests only".
    const members = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(200);
    const suggestedDomains = new Set<string>();
    for (const member of members) {
      const memberUser = await ctx.db.get(member.userId);
      const domain = memberUser?.email ? emailDomain(memberUser.email) : "";
      if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) suggestedDomains.add(domain);
    }
    return {
      suggestedDomains: [...suggestedDomains].slice(0, 10),
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
    autoJoin: autoJoinValidator,
    // Optional so older clients still validate.
    joinInternalOnly: v.optional(v.boolean()),
    internalDomains: v.optional(v.array(v.string())),
    skipRecurring: v.optional(v.boolean()),
    outputLanguage: v.optional(v.string()),
    briefEnabled: v.optional(v.boolean()),
    briefLeadMin: v.optional(v.number()),
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
    const domains = (args.internalDomains ?? [])
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    const badDomain = domains.find((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d));
    if (badDomain) throw new Error(`"${badDomain}" isn't a valid domain`);
    if (domains.length > 20) throw new Error("Up to 20 company domains");
    if (args.outputLanguage && !(args.outputLanguage in OUTPUT_LANGUAGES)) {
      throw new Error("Unsupported language");
    }
    const patch = {
      botName: args.botName.trim().slice(0, 100) || undefined,
      recapAudience: args.recapAudience,
      recapExtraEmails: emails,
      retentionDays: Math.min(365, Math.max(1, Math.round(args.retentionDays))),
      autoJoin: args.autoJoin,
      ...(args.joinInternalOnly !== undefined && {
        joinInternalOnly: args.joinInternalOnly,
      }),
      ...(args.internalDomains !== undefined && { internalDomains: domains }),
      ...(args.skipRecurring !== undefined && { skipRecurring: args.skipRecurring }),
      ...(args.outputLanguage !== undefined && { outputLanguage: args.outputLanguage }),
      ...(args.briefEnabled !== undefined && { briefEnabled: args.briefEnabled }),
      ...(args.briefLeadMin !== undefined && {
        briefLeadMin: Math.min(24 * 60, Math.max(10, Math.round(args.briefLeadMin))),
      }),
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

/**
 * Auto-join mode picked while connecting a calendar. An explicit pick
 * always applies; with none, "hosting" switches on only if nobody has ever
 * chosen a mode (an existing choice is never overwritten).
 */
export const applyConnectAutoJoin = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    autoJoin: v.optional(autoJoinValidator),
  },
  handler: async (ctx, args) => {
    const row = await settingsRow(ctx, args.workspaceId);
    if (!args.autoJoin && row?.autoJoin !== undefined) return;
    const autoJoin = args.autoJoin ?? "hosting";
    if (row) await ctx.db.patch(row._id, { autoJoin });
    else await ctx.db.insert("noteTakerSettings", { workspaceId: args.workspaceId, autoJoin });
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

/** A ?meeting=<id> deep link → the id, if it's a meeting the caller may open. */
export const resolveMeetingId = query({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<Id<"meetings"> | null> => {
    const meetingId = ctx.db.normalizeId("meetings", args.id);
    if (!meetingId) return null;
    const own = await ownMeeting(ctx, meetingId);
    return own ? meetingId : null;
  },
});

const sourceValidator = v.union(
  v.literal("manual"),
  v.literal("calendar"),
  v.literal("calcom"),
  v.literal("upload"),
);

export const listMeetings = query({
  args: {
    paginationOpts: paginationOptsValidator,
    // Filters (all optional). A meeting type is a smart folder.
    meetingType: v.optional(v.string()),
    folderId: v.optional(v.id("noteFolders")),
    source: v.optional(sourceValidator),
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const caller = await callerWorkspace(ctx);
    if (!caller) {
      return {
        page: [] as ReturnType<typeof lightMeeting>[],
        isDone: true,
        continueCursor: "",
      };
    }
    const workspaceId = caller.workspace._id;
    const base = args.meetingType
      ? ctx.db
          .query("meetings")
          .withIndex("by_workspace_type", (q) =>
            q.eq("workspaceId", workspaceId).eq("meetingType", args.meetingType),
          )
      : ctx.db
          .query("meetings")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId));
    const result = await base
      .order("desc")
      .filter((q) => {
        const conditions = [];
        if (args.source) conditions.push(q.eq(q.field("source"), args.source));
        if (args.since) conditions.push(q.gte(q.field("_creationTime"), args.since));
        return conditions.length > 0 ? q.and(...conditions) : true;
      })
      .paginate(args.paginationOpts);
    // Folder membership is an array — filtered after the page is read (a
    // page can come back short; "Load more" keeps going).
    const page = args.folderId
      ? result.page.filter((m) => m.folderIds?.includes(args.folderId!))
      : result.page;
    return { ...result, page: page.map(lightMeeting) };
  },
});

/**
 * Meetings the bot didn't record, newest first, with why. A skip the user
 * chose (or an event deleted from the calendar) isn't a failure.
 */
export const listIncomplete = query({
  args: {},
  handler: async (ctx) => {
    const caller = await callerWorkspace(ctx);
    if (!caller) return { meetings: [], recentCount: 0 };
    const recent = await ctx.db
      .query("meetings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", caller.workspace._id))
      .order("desc")
      .take(400);
    const incomplete = recent
      .filter(
        (m) =>
          m.status === "failed" ||
          (m.status === "cancelled" &&
            (m.failureCode !== undefined ||
              !/^(Skipped by you|Removed from the calendar)/.test(m.statusDetail ?? ""))),
      )
      .slice(0, 60);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60_000;
    return {
      meetings: incomplete.map(lightMeeting),
      recentCount: incomplete.filter((m) => m._creationTime > weekAgo).length,
    };
  },
});

/** Smart folders (one per meeting type) + custom folders, with counts. */
export const folderSummary = query({
  args: {},
  handler: async (ctx) => {
    const caller = await callerWorkspace(ctx);
    if (!caller) return null;
    const workspaceId = caller.workspace._id;
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(2000);
    const typeCounts: Record<string, number> = {};
    const folderCounts: Record<string, number> = {};
    for (const meeting of meetings) {
      if (meeting.meetingType) {
        typeCounts[meeting.meetingType] = (typeCounts[meeting.meetingType] ?? 0) + 1;
      }
      for (const folderId of meeting.folderIds ?? []) {
        folderCounts[folderId] = (folderCounts[folderId] ?? 0) + 1;
      }
    }
    const folders = await ctx.db
      .query("noteFolders")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(100);
    return {
      types: Object.entries(typeCounts)
        .filter(([type]) => isMeetingType(type))
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      folders: folders
        .map((folder) => ({
          _id: folder._id,
          name: folder.name,
          color: folder.color ?? null,
          rules: folder.rules,
          count: folderCounts[folder._id] ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
});

const folderRulesValidator = v.object({
  titleContains: v.array(v.string()),
  emailDomains: v.array(v.string()),
});

function cleanRules(rules: { titleContains: string[]; emailDomains: string[] }) {
  return {
    titleContains: rules.titleContains
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 20),
    emailDomains: rules.emailDomains
      .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean)
      .slice(0, 20),
  };
}

/** Create or edit a custom folder; rules re-file existing meetings too. */
export const saveFolder = mutation({
  args: {
    folderId: v.optional(v.id("noteFolders")),
    name: v.string(),
    color: v.optional(v.string()),
    rules: folderRulesValidator,
  },
  handler: async (ctx, args): Promise<Id<"noteFolders">> => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const name = args.name.trim().slice(0, 60);
    if (!name) throw new Error("Give the folder a name");
    const rules = cleanRules(args.rules);
    let folderId = args.folderId;
    if (folderId) {
      const folder = await ctx.db.get(folderId);
      if (!folder || folder.workspaceId !== workspace._id) throw new Error("Folder not found");
      await ctx.db.patch(folderId, { name, color: args.color, rules });
    } else {
      const count = (
        await ctx.db
          .query("noteFolders")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
          .take(100)
      ).length;
      if (count >= 100) throw new Error("Up to 100 folders");
      folderId = await ctx.db.insert("noteFolders", {
        workspaceId: workspace._id,
        name,
        color: args.color,
        rules,
        createdBy: user._id,
      });
    }
    // File the recent past by the new rules (manual additions are kept).
    if (rules.titleContains.length > 0 || rules.emailDomains.length > 0) {
      const recent = await ctx.db
        .query("meetings")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .order("desc")
        .take(500);
      for (const meeting of recent) {
        if (meeting.folderIds?.includes(folderId)) continue;
        const matches = await matchingFolders(ctx, meeting, meeting.title);
        if (matches.includes(folderId)) {
          await ctx.db.patch(meeting._id, {
            folderIds: [...(meeting.folderIds ?? []), folderId],
          });
        }
      }
    }
    return folderId;
  },
});

export const deleteFolder = mutation({
  args: { folderId: v.id("noteFolders") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const folder = await ctx.db.get(args.folderId);
    if (!workspace || !folder || folder.workspaceId !== workspace._id) {
      throw new Error("Folder not found");
    }
    await ctx.db.delete(args.folderId);
    // Meetings stay; only the label goes.
    const recent = await ctx.db
      .query("meetings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(2000);
    for (const meeting of recent) {
      if (meeting.folderIds?.includes(args.folderId)) {
        await ctx.db.patch(meeting._id, {
          folderIds: meeting.folderIds.filter((id) => id !== args.folderId),
        });
      }
    }
  },
});

/** Put a meeting in / take it out of a custom folder by hand. */
export const setMeetingFolder = mutation({
  args: {
    meetingId: v.id("meetings"),
    folderId: v.id("noteFolders"),
    inFolder: v.boolean(),
  },
  handler: async (ctx, args) => {
    const own = await ownMeeting(ctx, args.meetingId);
    const folder = await ctx.db.get(args.folderId);
    if (!own || !folder || folder.workspaceId !== own.workspace._id) {
      throw new Error("Not found");
    }
    const current = own.meeting.folderIds ?? [];
    const next = args.inFolder
      ? [...new Set([...current, args.folderId])]
      : current.filter((id) => id !== args.folderId);
    await ctx.db.patch(args.meetingId, { folderIds: next });
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

/**
 * An uploaded recording → a meeting row. The caller must own the fresh
 * upload; the workspace must hold the minimum (billing happens per minute
 * once the length is known, like a live meeting).
 */
export const createUploadMeeting = mutation({
  args: {
    storageId: v.id("_storage"),
    title: v.optional(v.string()),
    fileName: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"meetings">> => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    await claimUpload(ctx, user, args.storageId);
    const file = await ctx.db.system.get(args.storageId);
    const type = file?.contentType ?? "";
    if (type && !/^(audio|video)\//.test(type)) {
      throw new Error("Upload an audio or video recording");
    }
    const rate = await getConfigValue(ctx, "noteTakerCreditsPerMinute");
    if (workspace.credits < rate * MIN_BILLABLE_MINUTES) {
      throw new Error(
        `INSUFFICIENT_CREDITS: need ${rate * MIN_BILLABLE_MINUTES}, have ${workspace.credits}`,
      );
    }
    const title =
      args.title?.trim().slice(0, 140) ||
      args.fileName.replace(/\.[a-z0-9]+$/i, "").trim().slice(0, 140);
    return await ctx.db.insert("meetings", {
      workspaceId: workspace._id,
      userId: user._id,
      title: title || "Uploaded recording",
      autoTitle: !args.title?.trim(),
      meetingUrl: "",
      source: "upload",
      status: "processing",
      statusDetail: "Transcribing the recording…",
      mediaStorageId: args.storageId,
      startedAt: Date.now(),
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
      await syncAttendees(
        ctx,
        existing._id,
        args.workspaceId,
        args.attendees ?? existing.attendees,
        args.scheduledFor,
      );
      return existing._id;
    }
    const insertedId = await ctx.db.insert("meetings", {
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
    await syncAttendees(ctx, insertedId, args.workspaceId, args.attendees, args.scheduledFor);
    return insertedId;
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
    meetingType: v.optional(v.string()),
    meetingTypeLocked: v.optional(v.boolean()),
    failureCode: v.optional(v.string()),
    clearFailureCode: v.optional(v.boolean()),
    brief: v.optional(v.any()),
    briefScheduledFor: v.optional(v.number()),
  },
  handler: async (ctx, { meetingId, clearStatusDetail, clearFailureCode, ...patch }) => {
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
      ...(clearFailureCode && { failureCode: undefined }),
    });
  },
});

/** Mirror a meeting's invitee emails into meetingAttendees (brief lookups). */
async function syncAttendees(
  ctx: MutationCtx,
  meetingId: Id<"meetings">,
  workspaceId: Id<"workspaces">,
  attendees: { email?: string }[] | undefined,
  at: number,
) {
  const existing = await ctx.db
    .query("meetingAttendees")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  const want = new Set(
    (attendees ?? []).flatMap((a) => (a.email ? [a.email.trim().toLowerCase()] : [])),
  );
  for (const row of existing) {
    if (!want.has(row.email) || row.at !== at) await ctx.db.delete(row._id);
    else want.delete(row.email);
  }
  for (const email of [...want].slice(0, 100)) {
    await ctx.db.insert("meetingAttendees", { workspaceId, meetingId, email, at });
  }
}

/**
 * One-off: index invitee emails of existing meetings. Run until
 * `remaining: false`: node node_modules/convex/bin/main.js run noteTaker:backfillAttendees
 */
export const backfillAttendees = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("meetings")
      .paginate({ cursor: args.cursor ?? null, numItems: 100 });
    for (const meeting of page.page) {
      await syncAttendees(
        ctx,
        meeting._id,
        meeting.workspaceId,
        meeting.attendees,
        meeting.startedAt ?? meeting.scheduledFor ?? meeting._creationTime,
      );
    }
    return { cursor: page.continueCursor, remaining: !page.isDone };
  },
});

/** Custom folders whose rules match this meeting (title words / guest domains). */
async function matchingFolders(
  ctx: MutationCtx,
  meeting: Doc<"meetings">,
  title: string,
): Promise<Id<"noteFolders">[]> {
  const folders = await ctx.db
    .query("noteFolders")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", meeting.workspaceId))
    .take(100);
  const lowerTitle = title.toLowerCase();
  const domains = new Set(
    (meeting.attendees ?? []).flatMap((a) => (a.email ? [emailDomain(a.email)] : [])),
  );
  return folders
    .filter(
      (folder) =>
        folder.rules.titleContains.some((word) => lowerTitle.includes(word.toLowerCase())) ||
        folder.rules.emailDomains.some((domain) => domains.has(domain.toLowerCase())),
    )
    .map((folder) => folder._id);
}

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
    await syncAttendees(
      ctx,
      args.meetingId,
      meeting.workspaceId,
      attendees,
      args.startedAt ?? meeting.startedAt ?? meeting._creationTime,
    );
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
      meetingType?: string;
    };
    const title =
      meeting.autoTitle && notes.title?.trim()
        ? notes.title.trim().slice(0, 140)
        : meeting.title;
    // A type a person picked sticks; otherwise the AI's classification.
    const meetingType = meeting.meetingTypeLocked
      ? meeting.meetingType
      : isMeetingType(notes.meetingType)
        ? notes.meetingType
        : "general";
    const folderIds = [
      ...new Set([
        ...(meeting.folderIds ?? []),
        ...(await matchingFolders(ctx, meeting, title)),
      ]),
    ];
    const scored = scoreMeeting({
      analytics: meeting.analytics as MeetingAnalytics | undefined,
      notes: args.notes as MeetingNotes,
      durationSec: meeting.durationSec ?? 0,
      coachState: meeting.coachState as CoachState | undefined,
      agenda: meeting.agenda,
    });
    await ctx.db.patch(args.meetingId, {
      title,
      notes: args.notes,
      notesStatus: "ready",
      status: "done",
      statusDetail: undefined,
      meetingType,
      folderIds,
      score: scored?.score,
      scoreBreakdown: scored?.breakdown,
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

/**
 * One-off: score + type meetings written before those existed. Run from the
 * CLI until it reports `remaining: false`:
 *   node node_modules/convex/bin/main.js run noteTaker:backfillScores
 */
export const backfillScores = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("meetings")
      .paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let updated = 0;
    for (const meeting of page.page) {
      if (meeting.status !== "done" || !meeting.notes) continue;
      const notes = meeting.notes as MeetingNotes;
      const scored = scoreMeeting({
        analytics: meeting.analytics as MeetingAnalytics | undefined,
        notes,
        durationSec: meeting.durationSec ?? 0,
        coachState: meeting.coachState as CoachState | undefined,
        agenda: meeting.agenda,
      });
      const meetingType =
        meeting.meetingType ?? (isMeetingType(notes.meetingType) ? notes.meetingType : "general");
      await ctx.db.patch(meeting._id, {
        meetingType,
        ...(scored && { score: scored.score, scoreBreakdown: scored.breakdown }),
      });
      updated++;
    }
    return { updated, cursor: page.continueCursor, remaining: !page.isDone };
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
