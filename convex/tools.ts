import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { spendCredits } from "./lib/credits";
import { getConfigValue } from "./config";

/**
 * Post-paid charge, clamped to the balance (the run already happened — a
 * low balance must not fail it, mirroring the Note Taker's billing).
 */
async function chargeUpTo(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    owed: number;
    feature: string;
    description: string;
  },
): Promise<void> {
  const workspace = await ctx.db.get(args.workspaceId);
  const credits = Math.min(Math.ceil(args.owed), workspace?.credits ?? 0);
  if (credits <= 0) return;
  await spendCredits(ctx, {
    workspaceId: args.workspaceId,
    amount: credits,
    feature: args.feature,
    description: args.description,
    userId: args.userId,
  });
}

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
    const audit = await ctx.db.get(args.id);
    await ctx.db.patch(args.id, {
      status: args.status,
      result: args.result,
      error: args.error,
    });
    // Successful audits bill the flat token-cost rate; failures are free.
    if (audit && args.status === "done" && audit.status !== "done") {
      await chargeUpTo(ctx, {
        workspaceId: audit.workspaceId,
        userId: audit.userId,
        owed: await getConfigValue(ctx, "auditCredits"),
        feature: "audit",
        description: `Get Found audit — ${audit.target.slice(0, 60)}`,
      });
    }
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
    /** Measured audio length (Deepgram); caption pulls bill one minute. */
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.id);
    await ctx.db.patch(args.id, {
      status: args.status,
      text: args.text,
      error: args.error,
    });
    if (transcript && args.status === "done" && transcript.status !== "done") {
      const rate = await getConfigValue(ctx, "transcribeCreditsPerMinute");
      const minutes = Math.max(1, Math.ceil((args.durationSec ?? 0) / 60));
      await chargeUpTo(ctx, {
        workspaceId: transcript.workspaceId,
        userId: transcript.userId,
        owed: minutes * rate,
        feature: "transcribe",
        description: `Audio to Text — ${minutes} min`,
      });
    }
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
