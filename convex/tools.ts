import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";

// ── Audits (Get Found by AI) ────────────────────────────────────────────

export const listAudits = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    return await ctx.db
      .query("audits")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(50);
  },
});

export const startAudit = internalMutation({
  args: { target: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    return await ctx.db.insert("audits", {
      workspaceId: workspace._id,
      userId: user._id,
      target: args.target,
      status: "running",
    });
  },
});

export const finishAudit = internalMutation({
  args: {
    id: v.id("audits"),
    status: v.union(v.literal("done"), v.literal("failed")),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      result: args.result,
      error: args.error,
    });
  },
});

// ── Transcripts (Audio to Text) ─────────────────────────────────────────

export const listTranscripts = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    return await ctx.db
      .query("transcripts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(50);
  },
});

export const startTranscript = internalMutation({
  args: {
    sourceType: v.union(v.literal("upload"), v.literal("link")),
    source: v.string(),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    return await ctx.db.insert("transcripts", {
      workspaceId: workspace._id,
      userId: user._id,
      sourceType: args.sourceType,
      source: args.source,
      storageId: args.storageId,
      status: "running",
    });
  },
});

export const finishTranscript = internalMutation({
  args: {
    id: v.id("transcripts"),
    status: v.union(v.literal("done"), v.literal("failed")),
    text: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      text: args.text,
      error: args.error,
    });
  },
});

export const getTranscript = internalQuery({
  args: { id: v.id("transcripts") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

/** Owner-checked reset back to running so a failed row can be retried. */
export const restartTranscript = internalMutation({
  args: { id: v.id("transcripts") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const transcript = await ctx.db.get(args.id);
    if (!transcript || transcript.workspaceId !== workspace?._id) {
      throw new Error("Transcript not found");
    }
    await ctx.db.patch(args.id, {
      status: "running",
      error: undefined,
      text: undefined,
    });
  },
});

export const removeTranscript = mutation({
  args: { id: v.id("transcripts") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const transcript = await ctx.db.get(args.id);
    if (!transcript || transcript.workspaceId !== workspace?._id) return;
    if (transcript.storageId) {
      await ctx.storage.delete(transcript.storageId);
    }
    await ctx.db.delete(args.id);
  },
});
