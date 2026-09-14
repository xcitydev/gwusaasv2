import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { grantCredits } from "./lib/credits";
import { getConfigValue } from "./config";
import { planValidator } from "./schema";
import { notify } from "./notifications";

/**
 * Called by the client after Clerk Billing reports the active plan
 * (auth().has({plan})). Idempotent: plan credits are granted once per plan
 * via planCreditsGrantedFor, and the referral qualifies on first paid plan.
 *
 * TODO(hardening): verify against the Clerk backend API / webhook instead of
 * trusting the client-reported plan.
 */
export const syncPlan = mutation({
  args: { plan: planValidator },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    // Team members work inside the owner's workspace — their personal Clerk
    // plan must never rewrite it (a member reporting "free" would otherwise
    // downgrade the whole team).
    if (workspace.ownerId !== user._id) return { changed: false };
    if (workspace.plan === args.plan) return { changed: false };

    await ctx.db.patch(workspace._id, { plan: args.plan });
    if (args.plan === "free") return { changed: true };

    const [personalCredits, teamCredits, personalPrice, teamPrice, percent] =
      await Promise.all([
        getConfigValue(ctx, "personalPlanCredits"),
        getConfigValue(ctx, "teamPlanCredits"),
        getConfigValue(ctx, "personalPlanPriceUsd"),
        getConfigValue(ctx, "teamPlanPriceUsd"),
        getConfigValue(ctx, "referralPercent"),
      ]);
    const credits = args.plan === "team" ? teamCredits : personalCredits;
    const priceUsd = args.plan === "team" ? teamPrice : personalPrice;

    if (workspace.planCreditsGrantedFor !== args.plan) {
      await grantCredits(ctx, {
        workspaceId: workspace._id,
        amount: credits,
        feature: "plan_grant",
        description: `${args.plan} plan credits`,
        userId: user._id,
      });
      await ctx.db.patch(workspace._id, { planCreditsGrantedFor: args.plan });
      await ctx.db.insert("purchases", {
        workspaceId: workspace._id,
        userId: user._id,
        kind: "subscription",
        amountUsd: priceUsd,
        status: "paid",
        meta: { plan: args.plan },
      });
    }

    // One-time 30% referral payout — first paid plan only.
    if (user.referredBy) {
      const referral = await ctx.db
        .query("referrals")
        .withIndex("by_referred", (q) => q.eq("referredUserId", user._id))
        .unique();
      if (referral && referral.status === "pending") {
        const payoutUsd = Math.round(priceUsd * (percent / 100) * 100) / 100;
        await ctx.db.patch(referral._id, {
          status: "qualified",
          plan: args.plan,
          payoutUsd,
        });
        await notify(ctx, {
          userId: referral.referrerUserId,
          type: "referral_qualified",
          title: `You earned $${payoutUsd} from a referral!`,
          body: "Someone you referred just subscribed.",
          href: "/referrals",
        });
      }
    }
    return { changed: true };
  },
});

export const ledger = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    return await ctx.db
      .query("creditLedger")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(50);
  },
});

export const topUp = mutation({
  args: { credits: v.number() },
  handler: async () => {
    // Top-ups go through Stripe checkout alongside Clerk Billing — wired in
    // when payment keys are added. Until then this is a clear error.
    throw new Error("NOT_CONFIGURED: Credit top-ups activate with billing keys.");
  },
});
