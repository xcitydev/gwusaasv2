import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  findImageModel,
  findVideoModel,
  findMotionModel,
  MOTION_MAX_SECONDS,
} from "../lib/ai-models";
import { runFal } from "./lib/fal";
import { probeMp4DurationSec } from "./lib/mp4";

/**
 * Generation pipeline: charge credits + create the record, call fal.ai,
 * store the result. Failures refund automatically (see generations.finish).
 * Requires FAL_KEY on the deployment; without it the action fails fast
 * BEFORE charging anything.
 */
export const generate = action({
  args: {
    kind: v.union(v.literal("image"), v.literal("video"), v.literal("motion")),
    modelId: v.string(),
    prompt: v.string(),
    resolution: v.string(),
    durationSec: v.optional(v.number()),
    referenceUrl: v.optional(v.string()),
    // Motion control: the driving video + whose background to keep.
    videoUrl: v.optional(v.string()),
    characterOrientation: v.optional(
      v.union(v.literal("image"), v.literal("video")),
    ),
  },
  handler: async (ctx, args): Promise<Id<"generations">> => {
    // Resolve the exact fal route up front — video models split into
    // text-to-video / image-to-video endpoints.
    let provider: string;
    let durationSec = args.durationSec;
    let prompt = args.prompt;
    if (args.kind === "motion") {
      const model = findMotionModel(args.modelId);
      if (!model || !model.available) throw new Error("Unknown model");
      if (!args.referenceUrl) throw new Error("Add the character image first");
      if (!args.videoUrl) throw new Error("Add the motion video first");
      const orientation = args.characterOrientation ?? "video";
      const maxSec = MOTION_MAX_SECONDS[orientation];
      // Bill on the driving video's real length (read from the file), not
      // on what the client measured; fall back to the client for formats
      // the prober can't read.
      const probed = await probeMp4DurationSec(args.videoUrl);
      const seconds = Math.ceil(probed ?? args.durationSec ?? 0);
      if (seconds <= 0) {
        throw new Error("Couldn't read the motion video's length — try an MP4 or MOV");
      }
      if (seconds > maxSec) {
        throw new Error(
          `Keep the motion video under ${maxSec} seconds when the background comes from the ${orientation}`,
        );
      }
      durationSec = seconds;
      prompt = args.prompt.trim() || `Motion control · ${model.label}`;
      provider = model.provider;
    } else if (args.kind === "image") {
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
      prompt,
      params: {
        resolution: args.resolution,
        durationSec,
        referenceUrl: args.referenceUrl,
        ...(args.kind === "motion" && {
          videoUrl: args.videoUrl,
          characterOrientation: args.characterOrientation ?? "video",
        }),
      },
      durationSec,
    });

    try {
      const resultUrl = await runFal(
        provider,
        {
          prompt: args.kind === "motion" ? args.prompt : prompt,
          resolution: args.resolution,
          durationSec,
          referenceUrl: args.referenceUrl,
          kind: args.kind,
          videoUrl: args.videoUrl,
          characterOrientation: args.characterOrientation,
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
