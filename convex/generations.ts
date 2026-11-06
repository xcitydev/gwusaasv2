import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { publicRowError } from "./incidents";
import { v } from "convex/values";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { grantCredits, spendCredits } from "./lib/credits";
import { getConfigValue } from "./config";
import { costInCredits } from "../lib/ai-models";
import { studioCreditsFromUsd } from "../lib/studio-models";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    return await ctx.db
      .query("generations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(100);
  },
});

/** Keeps fal's request id on the record so results can be recovered manually. */
export const attachProviderRequest = internalMutation({
  args: { id: v.id("generations"), requestId: v.string() },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.id);
    if (!generation) return;
    await ctx.db.patch(args.id, {
      params: { ...(generation.params ?? {}), falRequestId: args.requestId },
    });
  },
});

/** Delete a finished generation from the library. No refund — the work ran. */
export const remove = mutation({
  args: { id: v.id("generations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const generation = await ctx.db.get(args.id);
    if (!generation || generation.workspaceId !== workspace._id) {
      throw new Error("Not found");
    }
    await ctx.db.delete(args.id);
  },
});

/** Current pricing inputs so the client can show live cost estimates. */
export const pricing = query({
  args: {},
  handler: async (ctx) => {
    const [markup, creditPriceUsd] = await Promise.all([
      getConfigValue(ctx, "generationMarkup"),
      getConfigValue(ctx, "creditPriceUsd"),
    ]);
    return { markup, creditPriceUsd };
  },
});

/**
 * Charges credits and creates the pending record — called by the generate
 * action BEFORE the provider request, inside one transaction.
 */
export const start = internalMutation({
  args: {
    kind: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("edit"),
      v.literal("motion"),
      v.literal("audio"),
    ),
    model: v.string(),
    prompt: v.string(),
    params: v.any(),
    durationSec: v.optional(v.number()),
    // fal jobs: the validated size (some models bill by resolution).
    resolution: v.optional(v.string()),
    // Studio (Higgsfield) jobs: priced from their live /estimate (USD),
    // marked up like everything else.
    // Audio (ElevenLabs) jobs are priced the same way, from a USD cost.
    provider: v.optional(v.union(v.literal("higgsfield"), v.literal("elevenlabs"))),
    baseUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    // Motion control is driven by the video, not a prompt.
    if (!args.prompt.trim() && args.kind !== "motion" && args.kind !== "audio") {
      throw new Error("Write a prompt first");
    }

    const [markup, creditPriceUsd] = await Promise.all([
      getConfigValue(ctx, "generationMarkup"),
      getConfigValue(ctx, "creditPriceUsd"),
    ]);
    const credits =
      args.provider === "higgsfield" || args.provider === "elevenlabs"
        ? studioCreditsFromUsd({
            baseUsd: args.baseUsd ?? 0,
            markup,
            creditPriceUsd,
          })
        : args.kind === "audio"
          ? 0
          : costInCredits({
            kind: args.kind === "edit" ? "image" : args.kind,
            modelId: args.model,
            durationSec: args.durationSec,
            resolution: args.resolution,
            markup,
            creditPriceUsd,
          });
    if (credits <= 0) throw new Error("Unknown model");

    await spendCredits(ctx, {
      workspaceId: workspace._id,
      amount: credits,
      feature: "create_ai",
      description: `${args.kind} generation (${args.model})`,
      userId: user._id,
    });

    const generationId = await ctx.db.insert("generations", {
      workspaceId: workspace._id,
      userId: user._id,
      kind: args.kind,
      model: args.model,
      prompt: args.prompt,
      params: args.params,
      status: "pending",
      costCredits: credits,
      ...(args.provider && { provider: args.provider }),
    });
    return { generationId, credits, workspaceId: workspace._id };
  },
});

// ── Studio lifecycle helpers ────────────────────────────────────────────

export const getInternal = internalQuery({
  args: { id: v.id("generations") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

/** Auth-checked read for user-triggered actions on one generation. */
export const getOwn = internalQuery({
  args: { id: v.id("generations") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const generation = await ctx.db.get(args.id);
    if (!generation || generation.workspaceId !== workspace?._id) return null;
    return generation;
  },
});

export const getByProviderRequest = internalQuery({
  args: { providerRequestId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("generations")
      .withIndex("by_provider_request", (q) =>
        q.eq("providerRequestId", args.providerRequestId),
      )
      .first(),
});

/** The upstream job is queued: remember how to follow and cancel it. */
export const markSubmitted = internalMutation({
  args: {
    id: v.id("generations"),
    providerRequestId: v.string(),
    statusUrl: v.string(),
    cancelUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.id);
    if (!generation) return;
    await ctx.db.patch(args.id, {
      status: "running",
      providerRequestId: args.providerRequestId,
      params: {
        ...(generation.params ?? {}),
        hfStatusUrl: args.statusUrl,
        hfCancelUrl: args.cancelUrl,
        hfSubmittedAt: Date.now(),
      },
    });
  },
});

/**
 * Batch jobs (Soul ×4, Ads Studio) return several files under one charge:
 * the first lands on the parent row, the rest become their own done rows
 * at no extra cost so each shows (and downloads) on its own.
 */
export const addExtraResults = internalMutation({
  args: {
    parentId: v.id("generations"),
    results: v.array(v.object({ resultUrl: v.string(), storageId: v.optional(v.id("_storage")) })),
  },
  handler: async (ctx, args) => {
    const parent = await ctx.db.get(args.parentId);
    if (!parent || parent.status !== "done") return;
    const already = (parent.params as { extraCount?: number } | undefined)?.extraCount;
    if (already) return; // idempotent: poll + webhook can both finish a job
    for (const result of args.results) {
      await ctx.db.insert("generations", {
        workspaceId: parent.workspaceId,
        userId: parent.userId,
        kind: parent.kind,
        model: parent.model,
        prompt: parent.prompt,
        params: { batchOf: parent._id },
        status: "done",
        costCredits: 0,
        resultUrl: result.resultUrl,
        storageId: result.storageId,
        provider: parent.provider,
      });
    }
    await ctx.db.patch(parent._id, {
      params: { ...(parent.params ?? {}), extraCount: args.results.length },
    });
  },
});

export const finish = internalMutation({
  args: {
    id: v.id("generations"),
    status: v.union(v.literal("done"), v.literal("failed")),
    resultUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.id);
    if (!generation) return;
    // Idempotent: a webhook and a poll can both see the end of a job.
    if (generation.status === "done" || generation.status === "failed") return;
    await ctx.db.patch(args.id, {
      status: args.status,
      resultUrl: args.resultUrl,
      error: await publicRowError(ctx, args.error, {
        source: `${generation.kind} generation`,
        area: "generation",
        userId: generation.userId,
        workspaceId: generation.workspaceId,
      }),
      ...(args.storageId && { storageId: args.storageId }),
    });
    // Failed generations refund automatically.
    if (args.status === "failed" && generation.costCredits > 0) {
      await grantCredits(ctx, {
        workspaceId: generation.workspaceId,
        amount: generation.costCredits,
        feature: "create_ai_refund",
        description: `Refund: failed ${generation.kind} generation`,
        userId: generation.userId,
      });
    }
  },
});
