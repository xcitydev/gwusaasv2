import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { action } from "./lib/functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { getPrimaryWorkspace, requireUser } from "./lib/auth";
import { grantCredits, spendCredits } from "./lib/credits";
import { getConfigValue } from "./config";
import { studioCreditsFromUsd } from "../lib/studio-models";
import {
  HiggsfieldError,
  createCustomReference,
  getCustomReference,
  higgsfieldConfigured,
} from "./lib/higgsfield";

/**
 * Trained characters (Higgsfield Soul ID): the user uploads photos of one
 * person, we train a reusable identity, then the Soul models render that
 * face via custom_reference_id. Charged up front, refunded on failure.
 */

/** Higgsfield's listed Soul ID price; not on /estimate, so it's fixed here. */
export const SOUL_ID_USD = 2.5;
export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 20;
const POLL_MS = 30_000;
const SUBMIT_RETRY_MS = 60_000;
const MAX_SUBMIT_ATTEMPTS = 20;
const TIMEOUT_MS = 90 * 60_000;

const versionArg = v.union(v.literal("v1"), v.literal("v2"), v.literal("cinema"));

/** Credits one training costs (shown before the user commits). */
export const trainingPrice = query({
  args: {},
  handler: async (ctx) => {
    const [markup, creditPriceUsd] = await Promise.all([
      getConfigValue(ctx, "generationMarkup"),
      getConfigValue(ctx, "creditPriceUsd"),
    ]);
    return studioCreditsFromUsd({ baseUsd: SOUL_ID_USD, markup, creditPriceUsd });
  },
});

/** Charges the workspace and creates the character in "training". */
export const startTraining = internalMutation({
  args: { name: v.string(), version: versionArg, photoUrls: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ characterId: Id<"characters">; credits: number }> => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const photos = args.photoUrls.map((u) => u.trim()).filter((u) => /^https?:\/\/\S+$/i.test(u));
    if (photos.length < MIN_PHOTOS) throw new Error(`Add at least ${MIN_PHOTOS} photos`);
    if (photos.length > MAX_PHOTOS) throw new Error(`Use up to ${MAX_PHOTOS} photos`);

    const [markup, creditPriceUsd] = await Promise.all([
      getConfigValue(ctx, "generationMarkup"),
      getConfigValue(ctx, "creditPriceUsd"),
    ]);
    const credits = studioCreditsFromUsd({ baseUsd: SOUL_ID_USD, markup, creditPriceUsd });
    await spendCredits(ctx, {
      workspaceId: workspace._id,
      amount: credits,
      feature: "create_ai",
      description: "Train a character",
      userId: user._id,
    });
    const characterId = await ctx.db.insert("characters", {
      workspaceId: workspace._id,
      userId: user._id,
      name: args.name.trim().slice(0, 60) || "My character",
      imageUrl: photos[0],
      source: "upload",
      soul: {
        version: args.version,
        status: "training",
        photoUrls: photos,
        costCredits: credits,
        startedAt: Date.now(),
        attempts: 0,
      },
    });
    return { characterId, credits };
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("characters") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export const setTraining = internalMutation({
  args: {
    id: v.id("characters"),
    refId: v.optional(v.string()),
    attempts: v.optional(v.number()),
    thumbnailUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.id);
    if (!c?.soul || c.soul.status !== "training") return;
    await ctx.db.patch(args.id, {
      soul: {
        ...c.soul,
        ...(args.refId && { refId: args.refId }),
        ...(args.attempts !== undefined && { attempts: args.attempts }),
      },
    });
  },
});

/** Ready or failed; failures refund. Idempotent. */
export const finishTraining = internalMutation({
  args: {
    id: v.id("characters"),
    status: v.union(v.literal("ready"), v.literal("failed")),
    error: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.id);
    if (!c?.soul || c.soul.status !== "training") return;
    await ctx.db.patch(args.id, {
      ...(args.thumbnailUrl && { imageUrl: args.thumbnailUrl }),
      soul: { ...c.soul, status: args.status, error: args.error },
    });
    if (args.status === "failed" && c.soul.costCredits > 0) {
      await grantCredits(ctx, {
        workspaceId: c.workspaceId,
        amount: c.soul.costCredits,
        feature: "create_ai_refund",
        description: "Refund: character training failed",
        userId: c.userId,
      });
    }
  },
});

/** The Characters tab's "Train" button. */
export const train = action({
  args: { name: v.string(), version: versionArg, photoUrls: v.array(v.string()) },
  handler: async (ctx, args): Promise<Id<"characters">> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (!higgsfieldConfigured()) {
      throw new Error("NOT_CONFIGURED: Character training isn't connected yet.");
    }
    const { characterId } = await ctx.runMutation(internal.characterTraining.startTraining, args);
    await ctx.scheduler.runAfter(0, internal.characterTraining.submit, { id: characterId });
    return characterId;
  },
});

/** Creates the upstream reference; retries while their training slots are full. */
export const submit = internalAction({
  args: { id: v.id("characters") },
  handler: async (ctx, args): Promise<void> => {
    const c = await ctx.runQuery(internal.characterTraining.getInternal, { id: args.id });
    if (!c?.soul || c.soul.status !== "training" || c.soul.refId) return;
    const attempts = (c.soul.attempts ?? 0) + 1;
    try {
      const ref = await createCustomReference({
        name: `${c.name} (${String(c._id).slice(-6)})`,
        modelVersion: c.soul.version,
        imageUrls: c.soul.photoUrls,
      });
      await ctx.runMutation(internal.characterTraining.setTraining, { id: args.id, refId: ref.id, attempts });
      await ctx.scheduler.runAfter(POLL_MS, internal.characterTraining.poll, { id: args.id });
    } catch (error) {
      if (error instanceof HiggsfieldError && error.busy && attempts < MAX_SUBMIT_ATTEMPTS) {
        await ctx.runMutation(internal.characterTraining.setTraining, { id: args.id, attempts });
        await ctx.scheduler.runAfter(SUBMIT_RETRY_MS, internal.characterTraining.submit, { id: args.id });
        return;
      }
      console.error("Character training: submit failed", args.id, error);
      await ctx.runMutation(internal.characterTraining.finishTraining, {
        id: args.id,
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 300) : "Training couldn't start",
      });
    }
  },
});

/** Follows training until it ends; reschedules itself while it runs. */
export const poll = internalAction({
  args: { id: v.id("characters") },
  handler: async (ctx, args): Promise<void> => {
    const c = await ctx.runQuery(internal.characterTraining.getInternal, { id: args.id });
    if (!c?.soul || c.soul.status !== "training" || !c.soul.refId) return;
    try {
      const ref = await getCustomReference(c.soul.refId);
      if (ref.status === "completed") {
        await ctx.runMutation(internal.characterTraining.finishTraining, {
          id: args.id,
          status: "ready",
          thumbnailUrl: ref.thumbnail_url ?? undefined,
        });
        return;
      }
      if (ref.status === "failed") {
        await ctx.runMutation(internal.characterTraining.finishTraining, {
          id: args.id,
          status: "failed",
          error: ref.fail_reason?.slice(0, 300) || "Training failed — try clearer, varied photos of one person",
        });
        return;
      }
    } catch (error) {
      console.error("Character training: status check failed", args.id, error);
    }
    if (Date.now() - c.soul.startedAt > TIMEOUT_MS) {
      await ctx.runMutation(internal.characterTraining.finishTraining, {
        id: args.id,
        status: "failed",
        error: "Training took too long — credits refunded, try again",
      });
      return;
    }
    await ctx.scheduler.runAfter(POLL_MS, internal.characterTraining.poll, { id: args.id });
  },
});
