import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { grantCredits } from "./lib/credits";
import { getConfigValue } from "./config";
import { planValidator } from "./schema";

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
    // Whop live = Whop webhooks are the only writer of plan state. A Clerk
    // free plan reported by the browser must never downgrade a paid
    // workspace, so the whole Clerk Billing sync becomes a no-op.
    if (process.env.WHOP_API_KEY) return { changed: false };
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

    const [personalCredits, teamCredits, personalPrice, teamPrice] =
      await Promise.all([
        getConfigValue(ctx, "personalPlanCredits"),
        getConfigValue(ctx, "teamPlanCredits"),
        getConfigValue(ctx, "personalPlanPriceUsd"),
        getConfigValue(ctx, "teamPlanPriceUsd"),
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

    // Referral commissions (15% of every payment, for life) are recorded only
    // from real Whop invoices in whop.handlePaymentSucceeded. A plan sync
    // carries no invoice, so there is nothing to pay out here.
    return { changed: true };
  },
});

const LEDGER_PAGE_SIZE = 10;
// Numbered pagination needs a total; cap the count so one huge ledger can't
// make this query heavy. 1000 entries = 100 pages — plenty of history.
const LEDGER_MAX_ROWS = 1000;

export const ledger = query({
  args: { page: v.number() },
  handler: async (ctx, args) => {
    const empty = { rows: [], total: 0, pageSize: LEDGER_PAGE_SIZE };
    const user = await getCurrentUser(ctx);
    if (!user) return empty;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return empty;
    const all = await ctx.db
      .query("creditLedger")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(LEDGER_MAX_ROWS);
    const start = Math.max(0, Math.floor(args.page)) * LEDGER_PAGE_SIZE;
    return {
      rows: all.slice(start, start + LEDGER_PAGE_SIZE),
      total: all.length,
      pageSize: LEDGER_PAGE_SIZE,
    };
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
