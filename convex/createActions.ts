import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { findImageModel, findVideoModel } from "../lib/ai-models";
import { runFal } from "./lib/fal";

/**
 * Generation pipeline: charge credits + create the record, call fal.ai,
 * store the result. Failures refund automatically (see generations.finish).
 * Requires FAL_KEY on the deployment; without it the action fails fast
 * BEFORE charging anything.
 */
export const generate = action({
  args: {
    kind: v.union(v.literal("image"), v.literal("video")),
    modelId: v.string(),
    prompt: v.string(),
    resolution: v.string(),
    durationSec: v.optional(v.number()),
    referenceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"generations">> => {
    // Resolve the exact fal route up front — video models split into
    // text-to-video / image-to-video endpoints.
    let provider: string;
    if (args.kind === "image") {
      const model = findImageModel(args.modelId);
      if (!model) throw new Error("Unknown model");
      if (args.referenceUrl && !model.supportsEdit) {
        throw new Error(
          `${model.label} can't use a reference image — pick Nano Banana (edit) to transform an image.`,
        );
      }
      provider = model.provider;
    } else {
      const model = findVideoModel(args.modelId);
      if (!model) throw new Error("Unknown model");
      const route = args.referenceUrl ? model.providerI2V : model.providerT2V;
      if (!route) {
        throw new Error(
          args.referenceUrl
            ? `${model.label} doesn't support reference images — remove it or pick another model.`
            : `${model.label} needs a reference image to start from.`,
        );
      }
      provider = route;
    }

    if (!process.env.FAL_KEY) {
      throw new Error(
        "NOT_CONFIGURED: The generation engine isn't connected yet (FAL_KEY).",
      );
    }

    const { generationId } = await ctx.runMutation(internal.generations.start, {
      kind: args.kind,
      model: args.modelId,
      prompt: args.prompt,
      params: {
        resolution: args.resolution,
        durationSec: args.durationSec,
        referenceUrl: args.referenceUrl,
      },
      durationSec: args.durationSec,
    });

    try {
      const resultUrl = await runFal(
        provider,
        {
          prompt: args.prompt,
          resolution: args.resolution,
          durationSec: args.durationSec,
          referenceUrl: args.referenceUrl,
          kind: args.kind,
        },
        async (requestId) => {
          await ctx.runMutation(internal.generations.attachProviderRequest, {
            id: generationId,
            requestId,
          });
        },
      );
      await ctx.runMutation(internal.generations.finish, {
        id: generationId,
        status: "done",
        resultUrl,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Generation failed";
      await ctx.runMutation(internal.generations.finish, {
        id: generationId,
        status: "failed",
        error: detail,
      });
      throw new Error(`Generation failed — your credits were refunded. (${detail})`);
    }
    return generationId;
  },
});
