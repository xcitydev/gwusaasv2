import {
  query,
  internalMutation,
  internalQuery,
  mutation,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { igPriorityValidator, igStageValidator } from "./schema";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { spendCredits, grantCredits } from "./lib/credits";
import { getConfigValue } from "./config";
import { notify } from "./notifications";

const sentByValidator = v.union(v.literal("human"), v.literal("ai"));
const messageKindValidator = v.union(v.literal("text"), v.literal("voice"));

/**
 * The client's reply voice comes from their Boost My Comments intake —
 * tone, length, emoji level, example messages they love. Latest wins.
 */
const VOICE_FIELDS = [
  "igHandle",
  "niche",
  "tone",
  "length",
  "emojiLevel",
  "likedExamples",
  "avoidList",
  "notes",
] as const;

async function voiceProfileFor(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
): Promise<Record<string, string> | null> {
  const submissions = await ctx.db
    .query("formSubmissions")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const latest = submissions
    .filter((sub) => sub.formSlug === "comment-engagement")
    .sort((a, b) => b._creationTime - a._creationTime)[0];
  if (!latest) return null;
  const data = latest.data as Record<string, unknown>;
  const profile: Record<string, string> = {};
  for (const key of VOICE_FIELDS) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) profile[key] = value.trim();
  }
  return Object.keys(profile).length > 0 ? profile : null;
}

/** Everything the AI needs to read a thread and speak for the client. */
async function copilotContext(
  ctx: QueryCtx,
  conversation: Doc<"igConversations">,
) {
  const account = await ctx.db
    .query("igAccounts")
    .withIndex("by_workspace", (q) =>
      q.eq("workspaceId", conversation.workspaceId),
    )
    .first();
  if (!account) return null;
  const workspace = await ctx.db.get(conversation.workspaceId);
  const messages = await ctx.db
    .query("igMessages")
    .withIndex("by_conversation", (q) =>
      q.eq("conversationId", conversation._id),
    )
    .order("desc")
    .take(30);
  return {
    conversation,
    account: {
      autopilot: account.autopilot ?? false,
      aiBrief: account.aiBrief ?? "",
      bookingLink: account.bookingLink ?? "",
      igUsername: account.igUsername ?? null,
    },
    workspaceName: workspace?.name ?? "",
    voiceProfile: await voiceProfileFor(ctx, conversation.workspaceId),
    messages: messages.reverse().map((m) => ({
      direction: m.direction,
      body: m.body,
      sentAt: m.sentAt,
      sentBy: m.sentBy ?? null,
      kind: m.kind ?? ("text" as const),
    })),
  };
}

// ── User-facing queries ─────────────────────────────────────────────────

export const myAccount = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return null;
    const account = await ctx.db
      .query("igAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .first();
    if (!account) return { status: "none" as const };
    return {
      status: account.status,
      igUsername: account.igUsername ?? null,
      ghlLocationId: account.ghlLocationId,
      autopilot: account.autopilot ?? false,
      aiBrief: account.aiBrief ?? "",
      bookingLink: account.bookingLink ?? "",
      voiceId: account.voiceId ?? null,
      ambiance: account.ambiance ?? null,
      hasVoiceProfile: Boolean(await voiceProfileFor(ctx, workspace._id)),
    };
  },
});

const inboxTabValidator = v.union(
  v.literal("needs_reply"),
  v.literal("qualified"),
  v.literal("mine"),
  v.literal("all"),
);

/**
 * Inbox list, newest first, one tab's filter applied server-side and paged
 * 50 at a time — the UI re-sorts each loaded page hot-first.
 */
export const listConversations = query({
  args: { tab: inboxTabValidator, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const empty = {
      page: [] as Doc<"igConversations">[],
      isDone: true,
      continueCursor: "",
    };
    const user = await getCurrentUser(ctx);
    if (!user) return empty;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return empty;
    const base = ctx.db
      .query("igConversations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc");
    const filtered =
      args.tab === "needs_reply"
        ? base.filter((q) =>
            q.or(
              q.eq(q.field("lastDirection"), "inbound"),
              q.eq(q.field("needsHuman"), true),
            ),
          )
        : args.tab === "qualified"
          ? base.filter((q) =>
              q.or(
                q.eq(q.field("stage"), "qualified"),
                q.eq(q.field("stage"), "booking_ready"),
              ),
            )
          : args.tab === "mine"
            ? base.filter((q) => q.eq(q.field("assigneeId"), user._id))
            : base;
    return await filtered.paginate(args.paginationOpts);
  },
});

/** Tab badge counts across the whole inbox (not just loaded pages). */
export const conversationCounts = query({
  args: {},
  handler: async (ctx) => {
    const zero = { needs_reply: 0, qualified: 0, mine: 0, all: 0 };
    const user = await getCurrentUser(ctx);
    if (!user) return zero;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return zero;
    const all = await ctx.db
      .query("igConversations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return {
      needs_reply: all.filter(
        (c) => c.lastDirection === "inbound" || c.needsHuman === true,
      ).length,
      qualified: all.filter(
        (c) => c.stage === "qualified" || c.stage === "booking_ready",
      ).length,
      mine: all.filter((c) => c.assigneeId === user._id).length,
      all: all.length,
    };
  },
});

/** One thread, live — the open pane subscribes to this. */
export const getConversation = query({
  args: { conversationId: v.id("igConversations") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.workspaceId !== workspace?._id) {
      return null;
    }
    return conversation;
  },
});

/** A short window of the message around the first hit. */
function snippetAround(body: string, term: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const first = term.split(/\s+/)[0]?.toLowerCase() ?? "";
  const at = first ? flat.toLowerCase().indexOf(first) : -1;
  if (at === -1) return flat.slice(0, 100);
  const start = Math.max(0, at - 40);
  const end = Math.min(flat.length, at + 80);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

/**
 * Full-text search across contact names AND message bodies (Convex search
 * indexes). Returns conversations with the matching message as a snippet.
 */
export const searchConversations = query({
  args: { q: v.string() },
  handler: async (ctx, args) => {
    const term = args.q.trim();
    const user = await getCurrentUser(ctx);
    if (!user || term.length < 2) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    const byName = await ctx.db
      .query("igConversations")
      .withSearchIndex("search_name", (q) =>
        q.search("contactName", term).eq("workspaceId", workspace._id),
      )
      .take(20);
    const hits = await ctx.db
      .query("igMessages")
      .withSearchIndex("search_body", (q) =>
        q.search("body", term).eq("workspaceId", workspace._id),
      )
      .take(60);
    const results = new Map<
      Id<"igConversations">,
      { conversation: Doc<"igConversations">; snippet: string | null }
    >();
    for (const conversation of byName) {
      results.set(conversation._id, { conversation, snippet: null });
    }
    for (const hit of hits) {
      const existing = results.get(hit.conversationId);
      if (existing?.snippet) continue;
      const conversation =
        existing?.conversation ?? (await ctx.db.get(hit.conversationId));
      if (!conversation) continue;
      results.set(hit.conversationId, {
        conversation,
        snippet: snippetAround(hit.body, term),
      });
    }
    return [...results.values()]
      .sort((a, b) => b.conversation.lastMessageAt - a.conversation.lastMessageAt)
      .slice(0, 40);
  },
});

export const listMessages = query({
  args: { conversationId: v.id("igConversations") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.workspaceId !== workspace?._id) return [];
    const messages = await ctx.db
      .query("igMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .take(500);
    return await Promise.all(
      messages.map(async (m) => ({
        ...m,
        audioUrl: m.audioStorageId
          ? await ctx.storage.getUrl(m.audioStorageId)
          : null,
      })),
    );
  },
});

export const markRead = mutation({
  args: { conversationId: v.id("igConversations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.workspaceId !== workspace?._id) return;
    if (conversation.unread) {
      await ctx.db.patch(args.conversationId, { unread: false });
    }
  },
});

/** Teammates a conversation can be assigned to (owner + members). */
export const assignableMembers = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const ids = new Set<Id<"users">>([
      workspace.ownerId,
      ...memberships.map((m) => m.userId),
    ]);
    const members: { userId: Id<"users">; name: string; email: string }[] = [];
    for (const id of ids) {
      const member = await ctx.db.get(id);
      if (member) {
        members.push({
          userId: member._id,
          name: member.name ?? member.email,
          email: member.email,
        });
      }
    }
    return members;
  },
});

async function ownConversation(
  ctx: QueryCtx,
  conversationId: Id<"igConversations">,
) {
  const user = await requireUser(ctx);
  const workspace = await getPrimaryWorkspace(ctx, user._id);
  const conversation = await ctx.db.get(conversationId);
  if (!workspace || !conversation || conversation.workspaceId !== workspace._id) {
    throw new Error("Conversation not found");
  }
  return { user, workspace, conversation };
}

export const assignConversation = mutation({
  args: {
    conversationId: v.id("igConversations"),
    assigneeId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const { workspace } = await ownConversation(ctx, args.conversationId);
    if (args.assigneeId && args.assigneeId !== workspace.ownerId) {
      const membership = await ctx.db
        .query("members")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", workspace._id).eq("userId", args.assigneeId!),
        )
        .unique();
      if (!membership) throw new Error("That person isn't on your team");
    }
    await ctx.db.patch(args.conversationId, { assigneeId: args.assigneeId });
  },
});

/** Hand-edit the AI's triage, or mark a flagged thread handled. */
export const setConversationMeta = mutation({
  args: {
    conversationId: v.id("igConversations"),
    priority: v.optional(igPriorityValidator),
    stage: v.optional(igStageValidator),
    needsHuman: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ownConversation(ctx, args.conversationId);
    const patch: Partial<Doc<"igConversations">> = {};
    if (args.priority) patch.priority = args.priority;
    if (args.stage) patch.stage = args.stage;
    if (args.needsHuman === false) {
      patch.needsHuman = false;
      patch.needsHumanReason = undefined;
    }
    await ctx.db.patch(args.conversationId, patch);
  },
});

export const setCopilotSettings = mutation({
  args: {
    autopilot: v.boolean(),
    aiBrief: v.string(),
    bookingLink: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const account = await ctx.db
      .query("igAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .first();
    if (!account) throw new Error("Enable Instagram DMs first");
    const aiBrief = args.aiBrief.trim().slice(0, 4000);
    const bookingLink = args.bookingLink.trim();
    if (bookingLink && !/^https?:\/\//i.test(bookingLink)) {
      throw new Error("The booking link should start with https://");
    }
    if (args.autopilot && !aiBrief) {
      throw new Error(
        "Write the brief first — autopilot only speaks from what's in it.",
      );
    }
    await ctx.db.patch(account._id, {
      autopilot: args.autopilot,
      aiBrief: aiBrief || undefined,
      bookingLink: bookingLink || undefined,
    });
  },
});

// ── Internals (webhook + actions) ───────────────────────────────────────

const ghlRole = v.union(v.literal("provisioner"), v.literal("messenger"));

export const getAgencyAuth = internalQuery({
  args: { role: ghlRole },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ghlAuth")
      .withIndex("by_role", (q) => q.eq("role", args.role))
      .first();
  },
});

export const saveAgencyAuth = internalMutation({
  args: {
    role: ghlRole,
    companyId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ghlAuth")
      .withIndex("by_role", (q) => q.eq("role", args.role))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("ghlAuth", args);
    }
  },
});

export const getAccountForCaller = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return null;
    const account = await ctx.db
      .query("igAccounts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .first();
    return {
      workspaceId: workspace._id,
      workspaceName: workspace.name,
      account,
    };
  },
});

export const insertAccount = internalMutation({
  args: { workspaceId: v.id("workspaces"), ghlLocationId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("igAccounts", {
      workspaceId: args.workspaceId,
      ghlLocationId: args.ghlLocationId,
      status: "pending_connect",
    });
  },
});

export const patchAccount = internalMutation({
  args: {
    id: v.id("igAccounts"),
    status: v.optional(
      v.union(v.literal("pending_connect"), v.literal("connected")),
    ),
    igUsername: v.optional(v.string()),
    locationToken: v.optional(v.string()),
    locationTokenExpiresAt: v.optional(v.number()),
    locationRefreshToken: v.optional(v.string()),
    ghlUserId: v.optional(v.string()),
    voiceId: v.optional(v.string()),
    ambiance: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch);
  },
});

export const getAccountByLocation = internalQuery({
  args: { ghlLocationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("igAccounts")
      .withIndex("by_location", (q) =>
        q.eq("ghlLocationId", args.ghlLocationId),
      )
      .first();
  },
});

/** Webhook ingest: upsert conversation + append message. */
export const ingestInbound = internalMutation({
  args: {
    ghlLocationId: v.string(),
    ghlConversationId: v.string(),
    ghlContactId: v.string(),
    ghlMessageId: v.optional(v.string()),
    body: v.string(),
    sentAt: v.number(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const account = await ctx.db
      .query("igAccounts")
      .withIndex("by_location", (q) =>
        q.eq("ghlLocationId", args.ghlLocationId),
      )
      .first();
    if (!account) return false; // not one of ours — drop
    // First inbound DM proves the IG connection is live.
    if (account.status !== "connected") {
      await ctx.db.patch(account._id, { status: "connected" });
    }
    const conversation = await ctx.db
      .query("igConversations")
      .withIndex("by_ghl", (q) =>
        q.eq("ghlConversationId", args.ghlConversationId),
      )
      .first();
    let conversationId: Id<"igConversations">;
    if (conversation) {
      conversationId = conversation._id;
      await ctx.db.patch(conversationId, {
        lastMessageAt: args.sentAt,
        lastPreview: args.body.slice(0, 120),
        unread: true,
        lastDirection: "inbound",
      });
    } else {
      conversationId = await ctx.db.insert("igConversations", {
        workspaceId: account.workspaceId,
        ghlConversationId: args.ghlConversationId,
        ghlContactId: args.ghlContactId,
        lastMessageAt: args.sentAt,
        lastPreview: args.body.slice(0, 120),
        unread: true,
        lastDirection: "inbound",
      });
    }
    // Dedupe on GHL message id (webhook retries).
    if (args.ghlMessageId) {
      const recent = await ctx.db
        .query("igMessages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversationId),
        )
        .order("desc")
        .take(20);
      if (recent.some((m) => m.ghlMessageId === args.ghlMessageId)) return true;
    }
    await ctx.db.insert("igMessages", {
      workspaceId: account.workspaceId,
      conversationId,
      direction: "inbound",
      body: args.body,
      ghlMessageId: args.ghlMessageId,
      sentAt: args.sentAt,
    });
    // Triage (and autopilot, when on) runs off the webhook, not in it.
    await ctx.scheduler.runAfter(0, internal.igAi.triageConversation, {
      conversationId,
    });
    return true;
  },
});

/** Identity-free variant for system jobs (webhook-scheduled actions). */
export const getConversationSystem = internalQuery({
  args: { conversationId: v.id("igConversations") },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return null;
    const account = await ctx.db
      .query("igAccounts")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", conversation.workspaceId),
      )
      .first();
    if (!account) return null;
    return {
      conversation,
      account: {
        id: account._id,
        ghlLocationId: account.ghlLocationId,
        locationToken: account.locationToken ?? null,
        locationTokenExpiresAt: account.locationTokenExpiresAt ?? 0,
        locationRefreshToken: account.locationRefreshToken ?? null,
      },
    };
  },
});

export const listAllAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("igAccounts").collect();
    return accounts.map((a) => a.ghlLocationId);
  },
});

export const getByGhlConversation = internalQuery({
  args: { ghlConversationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("igConversations")
      .withIndex("by_ghl", (q) =>
        q.eq("ghlConversationId", args.ghlConversationId),
      )
      .first();
  },
});

export const setContactName = internalMutation({
  args: { conversationId: v.id("igConversations"), name: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { contactName: args.name });
  },
});

export const getConversationForReply = internalQuery({
  args: { conversationId: v.id("igConversations") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.workspaceId !== workspace?._id) {
      return null;
    }
    const account = await ctx.db
      .query("igAccounts")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", conversation.workspaceId),
      )
      .first();
    if (!account) return null;
    const messages = await ctx.db
      .query("igMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(20);
    return {
      userId: user._id,
      conversation,
      account: {
        id: account._id,
        ghlLocationId: account.ghlLocationId,
        locationToken: account.locationToken ?? null,
        locationTokenExpiresAt: account.locationTokenExpiresAt ?? 0,
        locationRefreshToken: account.locationRefreshToken ?? null,
      },
      recentMessages: messages.reverse(),
    };
  },
});

// ── AI copilot internals ────────────────────────────────────────────────

/** Identity-free context for triage/autopilot (scheduled jobs). */
export const getTriageContext = internalQuery({
  args: { conversationId: v.id("igConversations") },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return null;
    return await copilotContext(ctx, conversation);
  },
});

/** Same context, but only for the workspace that owns the thread. */
export const getCopilotContext = internalQuery({
  args: { conversationId: v.id("igConversations") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.workspaceId !== workspace?._id) {
      return null;
    }
    return await copilotContext(ctx, conversation);
  },
});

export const setTriage = internalMutation({
  args: {
    conversationId: v.id("igConversations"),
    priority: igPriorityValidator,
    stage: igStageValidator,
    nextAction: v.string(),
  },
  handler: async (ctx, { conversationId, ...triage }) => {
    await ctx.db.patch(conversationId, { ...triage, triagedAt: Date.now() });
  },
});

/** Autopilot stood down — flag the thread and ping whoever owns it. */
export const flagNeedsHuman = internalMutation({
  args: { conversationId: v.id("igConversations"), reason: v.string() },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return;
    const reason = args.reason.slice(0, 200);
    await ctx.db.patch(args.conversationId, {
      needsHuman: true,
      needsHumanReason: reason,
      unread: true,
    });
    const workspace = await ctx.db.get(conversation.workspaceId);
    const recipient = conversation.assigneeId ?? workspace?.ownerId;
    if (!recipient) return;
    await notify(ctx, {
      userId: recipient,
      workspaceId: conversation.workspaceId,
      type: "ig_needs_human",
      title: `${conversation.contactName ?? "An Instagram lead"} needs you — autopilot paused`,
      body: reason,
      href: "/ig-dms",
    });
  },
});

// ── Voice-note billing ──────────────────────────────────────────────────

export const chargeVoiceNote = internalMutation({
  args: { chars: v.number() },
  handler: async (ctx, args): Promise<{ credits: number }> => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const rate = await getConfigValue(ctx, "voiceNoteCreditsPer1kChars");
    const credits = Math.max(1, Math.ceil((args.chars / 1000) * rate));
    await spendCredits(ctx, {
      workspaceId: workspace._id,
      amount: credits,
      feature: "ig_voice_note",
      description: `Instagram voice note — ${args.chars} characters`,
      userId: user._id,
    });
    return { credits };
  },
});

export const refundVoiceNote = internalMutation({
  args: { credits: v.number() },
  handler: async (ctx, args) => {
    if (args.credits <= 0) return;
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return;
    await grantCredits(ctx, {
      workspaceId: workspace._id,
      amount: args.credits,
      feature: "ig_voice_note",
      description: "Refund — voice note failed to send",
    });
  },
});

/**
 * TEMP one-shot: bind the "gwu agency" test location to the main workspace,
 * seeding its tokens from the messenger's Location-class OAuth grant that
 * landed in ghlAuth before igAccounts existed. Delete after the test.
 */
export const bindTestLocation = internalMutation({
  args: {},
  handler: async (ctx) => {
    const LOCATION_ID = "AuSqpnh5mcNN1oNcixKs";
    const existing = await ctx.db
      .query("igAccounts")
      .withIndex("by_location", (q) => q.eq("ghlLocationId", LOCATION_ID))
      .first();
    if (existing) return "already bound";
    const workspace = (await ctx.db.query("workspaces").collect()).find((w) =>
      w.name.includes("X-CITY"),
    );
    if (!workspace) throw new Error("workspace not found");
    const messengerAuth = (await ctx.db.query("ghlAuth").collect()).find(
      (r) => r.role === "messenger",
    );
    if (!messengerAuth) throw new Error("messenger auth not found");
    await ctx.db.insert("igAccounts", {
      workspaceId: workspace._id,
      ghlLocationId: LOCATION_ID,
      status: "pending_connect",
      locationToken: messengerAuth.accessToken,
      locationTokenExpiresAt: messengerAuth.expiresAt,
      locationRefreshToken: messengerAuth.refreshToken,
    });
    return `bound ${LOCATION_ID} to ${workspace.name}`;
  },
});

/**
 * Maintenance: cancel queued triage jobs (500 per call — run until 0),
 * e.g. after a backfill fanned out more classification than intended.
 */
export const cancelPendingTriage = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ cancelled: number }> => {
    const pending = await ctx.db.system
      .query("_scheduled_functions")
      .filter((q) => q.eq(q.field("state.kind"), "pending"))
      .take(500);
    let cancelled = 0;
    for (const job of pending) {
      if (!job.name.includes("triageConversation")) continue;
      await ctx.scheduler.cancel(job._id);
      cancelled++;
    }
    return { cancelled };
  },
});

/** Conversations the AI has never classified (backlog sweep). */
export const listUntriaged = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"igConversations">[]> => {
    const all = await ctx.db.query("igConversations").collect();
    return all.filter((c) => !c.triagedAt).map((c) => c._id);
  },
});

/** Sync-path upsert (API pull, not webhook): conversation shell. */
export const upsertSyncedConversation = internalMutation({
  args: {
    ghlLocationId: v.string(),
    ghlConversationId: v.string(),
    ghlContactId: v.string(),
    contactName: v.optional(v.string()),
    lastMessageAt: v.number(),
    lastPreview: v.optional(v.string()),
    lastDirection: v.optional(
      v.union(v.literal("inbound"), v.literal("outbound")),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    conversationId: Id<"igConversations">;
    // Newer activity than we hold (or nothing held yet) → fetch messages.
    stale: boolean;
  } | null> => {
    const account = await ctx.db
      .query("igAccounts")
      .withIndex("by_location", (q) =>
        q.eq("ghlLocationId", args.ghlLocationId),
      )
      .first();
    if (!account) return null;
    if (account.status !== "connected") {
      await ctx.db.patch(account._id, { status: "connected" });
    }
    const existing = await ctx.db
      .query("igConversations")
      .withIndex("by_ghl", (q) =>
        q.eq("ghlConversationId", args.ghlConversationId),
      )
      .first();
    if (existing) {
      const newer = args.lastMessageAt > existing.lastMessageAt;
      await ctx.db.patch(existing._id, {
        lastMessageAt: Math.max(existing.lastMessageAt, args.lastMessageAt),
        ...(args.lastPreview && { lastPreview: args.lastPreview.slice(0, 120) }),
        ...(args.contactName && { contactName: args.contactName }),
        ...(newer && args.lastDirection && { lastDirection: args.lastDirection }),
      });
      const anyMessage = await ctx.db
        .query("igMessages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", existing._id))
        .first();
      return { conversationId: existing._id, stale: newer || !anyMessage };
    }
    const conversationId = await ctx.db.insert("igConversations", {
      workspaceId: account.workspaceId,
      ghlConversationId: args.ghlConversationId,
      ghlContactId: args.ghlContactId,
      contactName: args.contactName,
      lastMessageAt: args.lastMessageAt,
      lastPreview: args.lastPreview?.slice(0, 120),
      // History pulled by sync isn't "new" to the user; live DMs are.
      unread: false,
      lastDirection: args.lastDirection,
    });
    return { conversationId, stale: true };
  },
});

/**
 * After a sync fetched a thread's messages: derive what GHL didn't tell us
 * (who spoke last) from the newest stored message.
 */
export const settleConversation = internalMutation({
  args: { conversationId: v.id("igConversations") },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return;
    const newest = await ctx.db
      .query("igMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .first();
    if (!newest) return;
    const patch: Partial<Doc<"igConversations">> = {};
    if (!conversation.lastDirection) patch.lastDirection = newest.direction;
    if (!conversation.lastPreview) patch.lastPreview = newest.body.slice(0, 120);
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.conversationId, patch);
    }
  },
});

/** Sync-path message insert with GHL-id dedupe. */
export const insertMessageIfNew = internalMutation({
  args: {
    conversationId: v.id("igConversations"),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    body: v.string(),
    ghlMessageId: v.string(),
    sentAt: v.number(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return false;
    const recent = await ctx.db
      .query("igMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(100);
    if (recent.some((m) => m.ghlMessageId === args.ghlMessageId)) return false;
    await ctx.db.insert("igMessages", {
      workspaceId: conversation.workspaceId,
      conversationId: args.conversationId,
      direction: args.direction,
      body: args.body,
      ghlMessageId: args.ghlMessageId,
      sentAt: args.sentAt,
    });
    if (args.sentAt > conversation.lastMessageAt) {
      await ctx.db.patch(args.conversationId, {
        lastMessageAt: args.sentAt,
        lastDirection: args.direction,
      });
    }
    return true;
  },
});

/** Record a reply we sent (called after the GHL send succeeds). */
export const recordOutbound = internalMutation({
  args: {
    conversationId: v.id("igConversations"),
    body: v.string(),
    ghlMessageId: v.optional(v.string()),
    sentBy: v.optional(sentByValidator),
    senderId: v.optional(v.id("users")),
    kind: v.optional(messageKindValidator),
    audioStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return;
    const now = Date.now();
    const sentBy = args.sentBy ?? "human";
    await ctx.db.insert("igMessages", {
      workspaceId: conversation.workspaceId,
      conversationId: args.conversationId,
      direction: "outbound",
      body: args.body,
      ghlMessageId: args.ghlMessageId,
      sentAt: now,
      sentBy,
      senderId: args.senderId,
      kind: args.kind ?? "text",
      audioStorageId: args.audioStorageId,
    });
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: now,
      lastPreview: (args.kind === "voice" ? "🎙 " : "") + args.body.slice(0, 120),
      unread: false,
      lastDirection: "outbound",
      // A human answering resolves an autopilot hand-off.
      ...(sentBy === "human" && { needsHuman: false, needsHumanReason: undefined }),
    });
  },
});
