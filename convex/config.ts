import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { QueryCtx } from "./_generated/server";
import { requireAdmin } from "./lib/auth";

/** Platform defaults; superadmin overrides live in the `config` table. */
export const CONFIG_DEFAULTS = {
  creditPriceUsd: 0.01,
  // What users pay per month for a dedicated phone number, charged in
  // credits (provider cost is $15 — the spread covers talk-time overhead).
  phoneNumberPriceUsd: 20,
  personalPlanCredits: 10000,
  teamPlanCredits: 30000,
  generationMarkup: 3,
  referralPercent: 50,
  // Where "someone filled a form / opened a ticket" notifications go.
  adminNotificationEmail: "",
  teamNotificationEmail: "",
  // Per-second credit price for AI receptionist / qualifier calls.
  voiceCreditsPerSecond: 1,
  // IG voice notes: credits per 1k characters spoken (Bland TTS is
  // ~$0.015/1k chars; the spread covers the ambiance render + storage).
  voiceNoteCreditsPer1kChars: 5,
  // Credits charged per imported lead, by source tier.
  leadCreditCostMaps: 1,
  leadCreditCostB2B: 5,
  leadCreditCostNiche: 2,
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
