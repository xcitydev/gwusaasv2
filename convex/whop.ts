import {
  query,
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { grantCredits } from "./lib/credits";
import { getConfigValue } from "./config";
import { notify } from "./notifications";
import {
  whopPlansConfigured,
  whopTopupsConfigured,
} from "./lib/whop";

/**
 * Whop fulfillment — the ONLY writer of plan state once Whop is live.
 * Everything here is driven by signature-verified webhooks (see http.ts);
 * the browser can never claim a plan. Metadata stamped at checkout
 * ({ workspaceId, userId, kind, … }) maps money back to workspaces.
 */

/** What the Settings UI can offer. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    return {
      plans: whopPlansConfigured(),
      topups: whopTopupsConfigured(),
      creditPriceUsd: await getConfigValue(ctx, "creditPriceUsd"),
      sandbox: process.env.WHOP_SANDBOX === "1",
    };
  },
});

/** Price a credit pack server-side (the action quotes before checkout). */
export const topupQuote = internalQuery({
  args: { credits: v.number() },
  handler: async (ctx, args) => {
    const price = await getConfigValue(ctx, "creditPriceUsd");
    const credits = Math.round(args.credits);
    if (credits < 100 || credits > 1_000_000) {
      throw new Error("Credit packs are between 100 and 1,000,000 credits.");
    }
    return { credits, usd: Math.max(1, Math.round(credits * price * 100) / 100) };
  },
});

/** Insert-if-new on the idempotency key; false = already processed. */
async function firstTime(
  ctx: MutationCtx,
  key: string,
  type: string,
): Promise<boolean> {
  const seen = await ctx.db
    .query("whopEvents")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (seen) return false;
  await ctx.db.insert("whopEvents", { key, type });
  return true;
}

function parseWorkspaceId(
  ctx: MutationCtx,
  metadata: Record<string, unknown> | null | undefined,
): Id<"workspaces"> | null {
  const raw = metadata?.workspaceId;
  if (typeof raw !== "string" || raw.length === 0) return null;
  return ctx.db.normalizeId("workspaces", raw);
}

async function buyerFromMetadata(
  ctx: MutationCtx,
  metadata: Record<string, unknown> | null | undefined,
  workspace: Doc<"workspaces">,
): Promise<Doc<"users"> | null> {
  const raw = metadata?.userId;
  const userId =
    typeof raw === "string" ? ctx.db.normalizeId("users", raw) : null;
  const user = userId ? await ctx.db.get(userId) : null;
  return user ?? (await ctx.db.get(workspace.ownerId));
}

/**
 * payment.succeeded — the fulfillment event. billing_reason tells the story:
 * subscription_create = first purchase (set plan + referral payout),
 * subscription_cycle = renewal (re-grant monthly credits),
 * one_time = a credit pack (metadata.kind "topup").
 */
export const handlePaymentSucceeded = internalMutation({
  args: {
    paymentId: v.string(),
    billingReason: v.optional(v.string()),
    membershipId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    usdTotal: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ handled: string }> => {
    const metadata = (args.metadata ?? {}) as Record<string, unknown>;
    const workspaceId = parseWorkspaceId(ctx, metadata);
    if (!workspaceId) {
      // Bought outside our app (no metadata) — surface it, never guess.
      console.error("WHOP: payment without workspaceId metadata", args.paymentId);
      return { handled: "unattributed" };
    }
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      console.error("WHOP: payment for unknown workspace", args.paymentId, workspaceId);
      return { handled: "unknown_workspace" };
    }
    // Idempotency is per payment — retries and duplicate deliveries no-op.
    if (!(await firstTime(ctx, `pay:${args.paymentId}`, "payment.succeeded"))) {
      return { handled: "duplicate" };
    }
    const buyer = await buyerFromMetadata(ctx, metadata, workspace);

    if (metadata.kind === "topup") {
      const credits = Math.round(Number(metadata.credits));
      if (!Number.isFinite(credits) || credits < 1 || credits > 1_000_000) {
        console.error("WHOP: topup with bad credits metadata", args.paymentId, metadata.credits);
        return { handled: "bad_topup" };
      }
      await grantCredits(ctx, {
        workspaceId: workspace._id,
        amount: credits,
        feature: "topup",
        description: `Credit top-up (${credits.toLocaleString()})`,
        userId: buyer?._id ?? workspace.ownerId,
      });
      await ctx.db.insert("purchases", {
        workspaceId: workspace._id,
        userId: buyer?._id ?? workspace.ownerId,
        kind: "topup",
        amountUsd: args.usdTotal ?? 0,
        status: "paid",
        meta: { whopPaymentId: args.paymentId, credits },
      });
      return { handled: "topup" };
    }

    // Plan payment (first or renewal).
    const plan = metadata.plan === "team" ? "team" : "personal";
    const firstPayment = args.billingReason !== "subscription_cycle";
    const [personalCredits, teamCredits, personalPrice, teamPrice, percent] =
      await Promise.all([
        getConfigValue(ctx, "personalPlanCredits"),
        getConfigValue(ctx, "teamPlanCredits"),
        getConfigValue(ctx, "personalPlanPriceUsd"),
        getConfigValue(ctx, "teamPlanPriceUsd"),
        getConfigValue(ctx, "referralPercent"),
      ]);
    const credits = plan === "team" ? teamCredits : personalCredits;
    const priceUsd = args.usdTotal ?? (plan === "team" ? teamPrice : personalPrice);

    await ctx.db.patch(workspace._id, {
      plan,
      planCreditsGrantedFor: plan,
      ...(args.membershipId && { whopMembershipId: args.membershipId }),
    });
    // Monthly credits ride on every successful charge, renewal included.
    await grantCredits(ctx, {
      workspaceId: workspace._id,
      amount: credits,
      feature: "plan_grant",
      description: firstPayment
        ? `${plan} plan credits`
        : `${plan} plan monthly credits`,
      userId: buyer?._id ?? workspace.ownerId,
    });
    await ctx.db.insert("purchases", {
      workspaceId: workspace._id,
      userId: buyer?._id ?? workspace.ownerId,
      kind: "subscription",
      amountUsd: priceUsd,
      status: "paid",
      meta: { plan, whopPaymentId: args.paymentId, renewal: !firstPayment },
    });

    // Referral payout — first paid plan only (ported from billing.syncPlan).
    if (firstPayment && buyer?.referredBy) {
      const referral = await ctx.db
        .query("referrals")
        .withIndex("by_referred", (q) => q.eq("referredUserId", buyer._id))
        .unique();
      if (referral && referral.status === "pending") {
        const payoutUsd = Math.round(priceUsd * (percent / 100) * 100) / 100;
        await ctx.db.patch(referral._id, {
          status: "qualified",
          plan,
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
    return { handled: firstPayment ? "plan_created" : "plan_renewed" };
  },
});

/** Statuses that mean the subscription no longer pays for access. */
const DEAD_STATUSES = new Set(["canceled", "expired", "completed", "unresolved"]);

/**
 * membership.* — the subscription lifecycle. We only act when a membership
 * we know (workspace.whopMembershipId) stops being payable: downgrade to
 * free, which snaps every plan gate shut. past_due keeps access (grace —
 * Whop retries the card and 3DS recovery before the membership dies).
 */
export const handleMembershipUpdate = internalMutation({
  args: {
    eventId: v.string(),
    membershipId: v.string(),
    membershipStatus: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ handled: string }> => {
    if (!args.membershipStatus || !DEAD_STATUSES.has(args.membershipStatus)) {
      return { handled: "ignored" };
    }
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_whop_membership", (q) =>
        q.eq("whopMembershipId", args.membershipId),
      )
      .first();
    if (!workspace) return { handled: "unknown_membership" };
    if (!(await firstTime(ctx, `evt:${args.eventId}`, "membership.update"))) {
      return { handled: "duplicate" };
    }
    if (workspace.plan === "free") return { handled: "already_free" };
    await ctx.db.patch(workspace._id, {
      plan: "free",
      planCreditsGrantedFor: undefined,
      whopMembershipId: undefined,
    });
    await notify(ctx, {
      userId: workspace.ownerId,
      type: "plan_ended",
      title: "Your subscription has ended",
      body: "Your workspace is back on the Free plan — resubscribe any time in Settings to unlock everything again.",
      href: "/settings",
    });
    return { handled: "downgraded" };
  },
});
