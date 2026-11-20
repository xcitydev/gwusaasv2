import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getConfigValue } from "./config";
import type { AudioPricing } from "../lib/audio-models";

/** Inputs for the Audio tab's live price (config-driven, like Studio). */
export const pricing = query({
  args: {},
  handler: async (ctx): Promise<AudioPricing> => {
    const [markup, creditPriceUsd, audioUsdPer1kChars, voiceChangeUsdPerMinute, dubbingUsdPerMinute] =
      await Promise.all([
        getConfigValue(ctx, "generationMarkup"),
        getConfigValue(ctx, "creditPriceUsd"),
        getConfigValue(ctx, "audioUsdPer1kChars"),
        getConfigValue(ctx, "voiceChangeUsdPerMinute"),
        getConfigValue(ctx, "dubbingUsdPerMinute"),
      ]);
    return {
      markup: Number(markup),
      creditPriceUsd: Number(creditPriceUsd),
      audioUsdPer1kChars: Number(audioUsdPer1kChars),
      voiceChangeUsdPerMinute: Number(voiceChangeUsdPerMinute),
      dubbingUsdPerMinute: Number(dubbingUsdPerMinute),
    };
  },
});

/** Merge keys into a generation's params (e.g. the upstream dub id). */
export const patchParams = internalMutation({
  args: { id: v.id("generations"), params: v.any(), status: v.optional(v.literal("running")) },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.id);
    if (!generation) return;
    await ctx.db.patch(args.id, {
      params: { ...(generation.params ?? {}), ...(args.params as Record<string, unknown>) },
      ...(args.status && generation.status === "pending" && { status: args.status }),
    });
  },
});
