import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { QueryCtx } from "./_generated/server";
import { requireAdmin } from "./lib/auth";

/**
 * Platform defaults; superadmin overrides live in the `config` table.
 *
 * PRICING MODEL (locked 2026-10-06): everything bills at provider cost
 * × 4.5, converted to credits at creditPriceUsd and rounded UP. Every
 * per-feature rate below is derived from that one rule — change a
 * provider's real cost, re-derive the rate.
 */
export const CONFIG_DEFAULTS = {
  creditPriceUsd: 0.01,
  // Phone number: Bland charges us $15/mo → ×4.5 = $67.50 = 6,750 credits.
  phoneNumberPriceUsd: 67.5,
  personalPlanCredits: 10000,
  teamPlanCredits: 30000,
  // Create with AI / Studio / carousels: provider cost × this, in credits.
  generationMarkup: 4.5,
  referralPercent: 50,
  // Where "someone filled a form / opened a ticket" notifications go.
  adminNotificationEmail: "",
  teamNotificationEmail: "",
  // Receptionist / cold-calling talk time: Bland ≈ $0.09/min all-in →
  // ×4.5 = $0.405/min = 0.675 credits/sec (billed ceil per call).
  voiceCreditsPerSecond: 0.675,
  // IG voice notes: Bland TTS ~$0.015/1k chars → ×4.5 = 6.75 cr/1k.
  voiceNoteCreditsPer1kChars: 6.75,
  // AI Note Taker: Recall bot + transcription ≈ $0.65/h → ×4.5 = $2.93/h
  // ≈ 4.9 credits/min, rounded to 5.
  noteTakerCreditsPerMinute: 5,
  // Credits per imported lead, by source tier (×4.5 on scrape+verify cost):
  // Maps ≈ 2¢ → 9 · LinkedIn/B2B ≈ 1.4¢ verified → 7 · niche ≈ 2¢ → 9.
  leadCreditCostMaps: 9,
  leadCreditCostB2B: 7,
  leadCreditCostNiche: 9,
  // IG Commenters (Leads tab): Apify comment scraper $2.60/1k comments →
  // ×4.5 = 1.17 cr per comment scraped; profile scraper $1.60/1k → ×4.5 =
  // 0.72 cr per profile found. Billed per job on actual counts, rounded up.
  igCommentCreditsEach: 1.17,
  igProfileCreditsEach: 0.72,
  // Get Found by AI: one audit burns ~$0.10 of Claude tokens → ×4.5 ≈ 45.
  auditCredits: 45,
  // Audio to Text: Deepgram ≈ $0.0043/min → ×4.5 ≈ 2 credits per audio
  // minute (caption pulls with no measured duration bill one minute).
  transcribeCreditsPerMinute: 2,
  // Personal plan monthly price (used for referral payout math).
  personalPlanPriceUsd: 97,
  teamPlanPriceUsd: 297,
} as const;

export type ConfigKey = keyof typeof CONFIG_DEFAULTS;

export async function getConfigValue<K extends ConfigKey>(
  ctx: QueryCtx,
  key: K,
): Promise<(typeof CONFIG_DEFAULTS)[K]> {
  const row = await ctx.db
    .query("config")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return (row?.value as (typeof CONFIG_DEFAULTS)[K]) ?? CONFIG_DEFAULTS[key];
}

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const overrides = await ctx.db.query("config").collect();
    const merged: Record<string, unknown> = { ...CONFIG_DEFAULTS };
    for (const row of overrides) merged[row.key] = row.value;
    return merged as typeof CONFIG_DEFAULTS;
  },
});

/** For actions, which have no direct db access. */
export const getValue = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await getConfigValue(ctx, args.key as ConfigKey);
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "super");
    if (!(args.key in CONFIG_DEFAULTS)) throw new Error(`Unknown config key: ${args.key}`);
    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("config", { key: args.key, value: args.value });
    }
  },
});
