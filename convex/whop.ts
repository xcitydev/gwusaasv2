import {
  query,
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { grantCredits, clawbackCredits } from "./lib/credits";
import { getConfigValue } from "./config";
import { notify } from "./notifications";
import {
  whopPlansConfigured,
  whopTopupsConfigured,
} from "./lib/whop";
import { quoteTopup, type TopupQuote } from "../lib/credit-packs";

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
  handler: async (ctx, args): Promise<TopupQuote> => {
    const price = await getConfigValue(ctx, "creditPriceUsd");
    // Packs (lib/credit-packs.ts): face value per credit plus bonus credits
    // when the amount is exactly a pack size; $10 minimum.
    return quoteTopup(args.credits, price);
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
      // metadata.credits is the TOTAL to grant (pack + bonus), stamped by
      // startTopupCheckout; base/bonus ride along for the ledger line.
      const credits = Math.round(Number(metadata.credits));
      if (!Number.isFinite(credits) || credits < 1 || credits > 1_200_000) {
        console.error("WHOP: topup with bad credits metadata", args.paymentId, metadata.credits);
        return { handled: "bad_topup" };
      }
      const bonus = Math.max(0, Math.round(Number(metadata.bonusCredits ?? 0)) || 0);
      const base = Math.max(0, Math.round(Number(metadata.baseCredits ?? credits)) || credits);
      const pack = typeof metadata.pack === "string" ? metadata.pack : "custom";
      await grantCredits(ctx, {
        workspaceId: workspace._id,
        amount: credits,
        feature: "topup",
        description:
          bonus > 0
            ? `Credit top-up (${base.toLocaleString()} + ${bonus.toLocaleString()} bonus)`
            : `Credit top-up (${credits.toLocaleString()})`,
        userId: buyer?._id ?? workspace.ownerId,
      });
      await ctx.db.insert("purchases", {
        workspaceId: workspace._id,
        userId: buyer?._id ?? workspace.ownerId,
        kind: "topup",
        amountUsd: args.usdTotal ?? 0,
        status: "paid",
        meta: { whopPaymentId: args.paymentId, credits, baseCredits: base, bonusCredits: bonus, pack },
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

    // Referral commission: referralPercent (15%) of EVERY plan payment the
    // referred buyer makes — the first charge and each renewal — for as long
    // as they keep renewing. The rate is locked on the referral at its first
    // payout so a later config change never shrinks an earned promise.
    if (buyer?.referredBy && priceUsd > 0) {
      const referral = await ctx.db
        .query("referrals")
        .withIndex("by_referred", (q) => q.eq("referredUserId", buyer._id))
        .unique();
      if (referral) {
        const lockedPercent = referral.commissionPercent ?? percent;
        const amountUsd = Math.round(priceUsd * (lockedPercent / 100) * 100) / 100;
        await ctx.db.insert("referralCommissions", {
          referralId: referral._id,
          referrerUserId: referral.referrerUserId,
          referredUserId: buyer._id,
          whopPaymentId: args.paymentId,
          kind: firstPayment ? "first" : "renewal",
          plan,
          paymentUsd: priceUsd,
          percent: lockedPercent,
          amountUsd,
          status: "owed",
        });
        await ctx.db.patch(referral._id, {
          status: "active",
          plan,
          commissionPercent: lockedPercent,
          lifetimeUsd: Math.round(((referral.lifetimeUsd ?? 0) + amountUsd) * 100) / 100,
          paymentCount: (referral.paymentCount ?? 0) + 1,
          lastPaymentAt: Date.now(),
          referredWorkspaceId: workspace._id,
        });
        await notify(ctx, {
          userId: referral.referrerUserId,
          type: firstPayment ? "referral_qualified" : "referral_renewal",
          title: `You earned $${amountUsd} from a referral`,
          body: firstPayment
            ? `Someone you referred just subscribed. You get ${lockedPercent}% of every renewal for as long as they stay.`
            : `A referral renewed their ${plan} plan — ${lockedPercent}% is yours again.`,
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
    // A churned referral stops earning; its lifetime total stays on record.
    // The referred buyer is usually the owner, but a team member can buy too,
    // so fall back to the workspace recorded at payout time.
    let referral = await ctx.db
      .query("referrals")
      .withIndex("by_referred", (q) => q.eq("referredUserId", workspace.ownerId))
      .unique();
    if (!referral || referral.referredWorkspaceId !== workspace._id) {
      referral =
        (await ctx.db
          .query("referrals")
          .filter((q) => q.eq(q.field("referredWorkspaceId"), workspace._id))
          .first()) ?? referral;
    }
    if (referral && referral.status === "active") {
      await ctx.db.patch(referral._id, { status: "churned" });
    }
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

/**
 * A refunded or voided payment. Credit packs are clawed back (never below
 * zero) and the owner is told; plan refunds are only logged, because access
 * is governed by the membership events and Whop ends the membership itself.
 */
export const handlePaymentRefunded = internalMutation({
  args: {
    eventId: v.string(),
    paymentId: v.string(),
    metadata: v.optional(v.any()),
    usdTotal: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ handled: string }> => {
    if (!(await firstTime(ctx, `refund:${args.paymentId}`, "payment.refunded"))) {
      return { handled: "duplicate" };
    }
    const metadata = (args.metadata ?? {}) as Record<string, unknown>;
    const workspaceId = parseWorkspaceId(ctx, metadata);
    if (!workspaceId) return { handled: "unattributed" };
    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) return { handled: "unknown_workspace" };

    if (metadata.kind !== "topup") {
      console.log("WHOP: plan payment refunded", args.paymentId, "workspace", workspaceId);
      return { handled: "plan_refund_logged" };
    }
    const credits = Math.round(Number(metadata.credits));
    if (!Number.isFinite(credits) || credits < 1) return { handled: "bad_topup" };
    // Whatever was already spent cannot come back; say so on the ledger line.
    const removable = Math.max(0, Math.min(workspace.credits, credits));
    const { removed } = await clawbackCredits(ctx, {
      workspaceId: workspace._id,
      amount: credits,
      feature: "topup_refund",
      description: `Refund of credit top-up (${credits.toLocaleString()} credits${
        removable < credits ? `, ${(credits - removable).toLocaleString()} already spent` : ""
      })`,
      meta: { whopPaymentId: args.paymentId, refundedUsd: args.usdTotal ?? null },
    });
    await notify(ctx, {
      userId: workspace.ownerId,
      workspaceId: workspace._id,
      type: "topup_refunded",
      title: "Credit top-up refunded",
      body: `${removed.toLocaleString()} credits were removed to match the refund.`,
      href: "/settings?tab=billing",
    });
    return { handled: "topup_refunded" };
  },
});
