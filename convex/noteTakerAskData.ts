import { query, mutation, internalQuery, internalMutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser, getPrimaryWorkspace } from "./lib/auth";
import { formatClock, type MeetingNotes } from "../lib/note-taker";
import { meetingTypeLabel } from "../lib/meeting-templates";
import type { Segment } from "./lib/transcript";

/**
 * Ask across meetings — data layer (threads, messages, retrieval). The
 * model call lives in noteTakerAsk.ts (Node runtime). Threads are private
 * to the user who started them.
 */

export const scopeValidator = v.object({
  kind: v.union(v.literal("all"), v.literal("folder"), v.literal("type"), v.literal("meeting")),
  id: v.optional(v.string()),
});

const citationValidator = v.object({
  ref: v.string(),
  meetingId: v.id("meetings"),
  title: v.string(),
  atSec: v.optional(v.number()),
});

async function caller(ctx: QueryCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  const workspace = await getPrimaryWorkspace(ctx, user._id);
  if (!workspace) return null;
  return { user, workspace };
}

// ── Public: threads ─────────────────────────────────────────────────────

export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    const me = await caller(ctx);
    if (!me) return [];
    const threads = await ctx.db
      .query("noteAskThreads")
      .withIndex("by_user", (q) => q.eq("userId", me.user._id))
      .order("desc")
      .take(30);
    return threads
      .filter((t) => t.workspaceId === me.workspace._id)
      .map((t) => ({ _id: t._id, title: t.title, scope: t.scope, updatedAt: t.updatedAt }));
  },
});

export const getThread = query({
  args: { threadId: v.id("noteAskThreads") },
  handler: async (ctx, args) => {
    const me = await caller(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!me || !thread || thread.userId !== me.user._id) return null;
    const messages = await ctx.db
      .query("noteAskMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .take(200);
    return { thread, messages };
  },
});

export const deleteThread = mutation({
  args: { threadId: v.id("noteAskThreads") },
  handler: async (ctx, args) => {
    const me = await caller(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!me || !thread || thread.userId !== me.user._id) throw new Error("Not found");
    const messages = await ctx.db
      .query("noteAskMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    for (const message of messages) await ctx.db.delete(message._id);
    await ctx.db.delete(args.threadId);
  },
});

// ── Internal: used by the ask action ────────────────────────────────────

/** Who's asking + their language setting (auth-checked). */
export const askCaller = internalQuery({
  args: { threadId: v.optional(v.id("noteAskThreads")) },
  handler: async (ctx, args) => {
    const me = await caller(ctx);
    if (!me) return null;
    let history: { role: "user" | "assistant"; content: string }[] = [];
    if (args.threadId) {
      const thread = await ctx.db.get(args.threadId);
      if (!thread || thread.userId !== me.user._id) return null;
      const messages = await ctx.db
        .query("noteAskMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", args.threadId!))
        .order("desc")
        .take(10);
      history = messages.reverse().map((m) => ({ role: m.role, content: m.content }));
    }
    const settings = await ctx.db
      .query("noteTakerSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", me.workspace._id))
      .first();
    return {
      userId: me.user._id,
      workspaceId: me.workspace._id,
      outputLanguage: settings?.outputLanguage ?? "auto",
      history,
    };
  },
});

export const startThread = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    title: v.string(),
    scope: scopeValidator,
  },
  handler: async (ctx, args): Promise<Id<"noteAskThreads">> =>
    await ctx.db.insert("noteAskThreads", { ...args, updatedAt: Date.now() }),
});

export const addMessage = internalMutation({
  args: {
    threadId: v.id("noteAskThreads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    citations: v.optional(v.array(citationValidator)),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("noteAskMessages", args);
    await ctx.db.patch(args.threadId, { updatedAt: Date.now() });
  },
});

/** Max meetings handed to the model in one answer. */
const MAX_MEETINGS = 24;
/** Per-meeting matched transcript moments. */
const MAX_MOMENTS = 5;

function inScope(
  meeting: Doc<"meetings">,
  scope: { kind: string; id?: string },
): boolean {
  if (meeting.status !== "done") return false;
  if (scope.kind === "type") return meeting.meetingType === scope.id;
  if (scope.kind === "folder") {
    return (meeting.folderIds ?? []).some((id) => id === scope.id);
  }
  if (scope.kind === "meeting") return meeting._id === scope.id;
  return true;
}

function momentsFor(segments: Segment[], keywords: string[]): Segment[] {
  const lowered = keywords.map((k) => k.toLowerCase());
  const hits: Segment[] = [];
  for (let i = 0; i < segments.length && hits.length < MAX_MOMENTS; i++) {
    const text = segments[i].text.toLowerCase();
    if (lowered.some((k) => text.includes(k))) {
      // The hit plus the line before it, for context.
      if (i > 0 && !hits.includes(segments[i - 1])) hits.push(segments[i - 1]);
      hits.push(segments[i]);
    }
  }
  return hits.slice(0, MAX_MOMENTS + 2);
}

function meetingBlock(
  label: string,
  meeting: Doc<"meetings">,
  moments: Segment[],
  fullTranscript: string | null,
): string {
  const notes = (meeting.notes ?? null) as MeetingNotes | null;
  const when = new Date(meeting.startedAt ?? meeting._creationTime).toISOString().slice(0, 10);
  const lines = [
    `### ${label} — ${meeting.title}`,
    `Date: ${when} · Type: ${meetingTypeLabel(meeting.meetingType)} · People: ${
      (meeting.attendees ?? []).map((a) => a.name).join(", ") || "unknown"
    }`,
  ];
  if (notes) {
    lines.push(`Summary: ${notes.summary}`);
    if (notes.decisions.length) lines.push(`Decisions: ${notes.decisions.join(" | ")}`);
    if (notes.actionItems.length) {
      lines.push(
        `Action items: ${notes.actionItems
          .map((a) => `${a.task}${a.owner ? ` (${a.owner}` : " (unassigned"}${a.due ? `, due ${a.due})` : ")"}`)
          .join(" | ")}`,
      );
    }
    if (notes.keyPoints.length) lines.push(`Key points: ${notes.keyPoints.slice(0, 6).join(" | ")}`);
    for (const section of notes.templateSections ?? []) {
      if (section.items.length) lines.push(`${section.heading}: ${section.items.join(" | ")}`);
    }
    if (notes.openQuestions.length) {
      lines.push(`Open questions: ${notes.openQuestions.join(" | ")}`);
    }
  }
  if (fullTranscript) {
    lines.push("Transcript:", fullTranscript);
  } else if (moments.length > 0) {
    lines.push(
      "Matching moments:",
      ...moments.map((s) => `[${label} ${formatClock(s.start)}] ${s.speaker}: ${s.text}`),
    );
  }
  return lines.join("\n");
}

/**
 * The meetings an answer gets to read: keyword hits on notes and on what
 * was said, topped up with the most recent meetings in scope. Returns a
 * prompt-ready corpus with M1…Mn labels and the label → meeting map.
 */
export const askCorpus = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    scope: scopeValidator,
    keywords: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspaceId, scope } = args;
    const keywords = args.keywords.map((k) => k.trim()).filter((k) => k.length > 1).slice(0, 6);

    const loadSegments = async (meetingId: Id<"meetings">) => {
      const parts = await ctx.db
        .query("meetingTranscriptParts")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .collect();
      return parts.flatMap((p) => p.segments);
    };

    // One meeting: hand over its whole transcript (it fits).
    if (scope.kind === "meeting" && scope.id) {
      const meetingId = ctx.db.normalizeId("meetings", scope.id);
      const meeting = meetingId ? await ctx.db.get(meetingId) : null;
      if (!meeting || meeting.workspaceId !== workspaceId || meeting.status !== "done") {
        return { corpus: "", labels: {} };
      }
      const segments = await loadSegments(meeting._id);
      const transcript = segments
        .map((s) => `[M1 ${formatClock(s.start)}] ${s.speaker}: ${s.text}`)
        .join("\n")
        .slice(0, 400_000);
      return {
        corpus: meetingBlock("M1", meeting, [], transcript),
        labels: { M1: { meetingId: meeting._id as string, title: meeting.title } },
      };
    }

    const ranked = new Map<Id<"meetings">, number>();
    const bump = (id: Id<"meetings">, by: number) => ranked.set(id, (ranked.get(id) ?? 0) + by);
    for (const keyword of keywords) {
      const metaHits = await ctx.db
        .query("meetings")
        .withSearchIndex("search_meta", (q) =>
          q.search("searchText", keyword).eq("workspaceId", workspaceId),
        )
        .take(10);
      for (const hit of metaHits) if (inScope(hit, scope)) bump(hit._id, 3);
      const textHits = await ctx.db
        .query("meetingTranscriptParts")
        .withSearchIndex("search_text", (q) =>
          q.search("text", keyword).eq("workspaceId", workspaceId),
        )
        .take(20);
      for (const hit of textHits) bump(hit.meetingId, 1);
    }

    // Recent meetings in scope fill the rest ("last week", "open items").
    const recentBase =
      scope.kind === "type" && scope.id
        ? ctx.db
            .query("meetings")
            .withIndex("by_workspace_type", (q) =>
              q.eq("workspaceId", workspaceId).eq("meetingType", scope.id),
            )
        : ctx.db.query("meetings").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId));
    const recent = await recentBase.order("desc").take(scope.kind === "folder" ? 400 : 60);
    let recentAdded = 0;
    for (const meeting of recent) {
      if (recentAdded >= 12) break;
      if (!inScope(meeting, scope)) continue;
      bump(meeting._id, 0.5);
      recentAdded++;
    }

    const picked: Doc<"meetings">[] = [];
    for (const [id] of [...ranked.entries()].sort((a, b) => b[1] - a[1])) {
      if (picked.length >= MAX_MEETINGS) break;
      const meeting = await ctx.db.get(id);
      if (meeting && meeting.workspaceId === workspaceId && inScope(meeting, scope)) {
        picked.push(meeting);
      }
    }
    // Oldest → newest reads naturally ("then … later …").
    picked.sort(
      (a, b) => (a.startedAt ?? a._creationTime) - (b.startedAt ?? b._creationTime),
    );

    const labels: Record<string, { meetingId: string; title: string }> = {};
    const blocks: string[] = [];
    for (const [index, meeting] of picked.entries()) {
      const label = `M${index + 1}`;
      labels[label] = { meetingId: meeting._id, title: meeting.title };
      const moments = keywords.length > 0 ? momentsFor(await loadSegments(meeting._id), keywords) : [];
      blocks.push(meetingBlock(label, meeting, moments, null));
    }
    return { corpus: blocks.join("\n\n"), labels };
  },
});
