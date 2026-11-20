import {
  query,
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { grantCredits, clawbackCredits } from "./lib/credits";
import { getConfigValue } from "./config";
import { notify } from "./notifications";
import { recordIncident } from "./incidents";
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

/** Commissions wait this long (Whop's refund window) before they're owed. */
const COMMISSION_HOLD_MS = 14 * 24 * 60 * 60 * 1000;

/** Collapse address variants that reach the same inbox (+tags, Gmail dots). */
function normalizeEmail(email: string): string {
  const [rawLocal, rawDomain] = email.trim().toLowerCase().split("@");
  if (!rawDomain) return email.trim().toLowerCase();
  const domain = rawDomain === "googlemail.com" ? "gmail.com" : rawDomain;
  let local = rawLocal.split("+")[0];
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** Referrer paying for themselves: same user, same inbox, or inside the paying workspace. */
async function isSelfReferral(
  ctx: MutationCtx,
  referrerUserId: Id<"users">,
  buyer: Doc<"users">,
  workspace: Doc<"workspaces">,
): Promise<boolean> {
  if (referrerUserId === buyer._id || referrerUserId === workspace.ownerId) return true;
  const referrer = await ctx.db.get(referrerUserId);
  if (!referrer) return false;
  if (normalizeEmail(referrer.email) === normalizeEmail(buyer.email)) return true;
  const owner = await ctx.db.get(workspace.ownerId);
  if (owner && normalizeEmail(referrer.email) === normalizeEmail(owner.email)) return true;
  const membership = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", referrerUserId))
    .filter((q) => q.eq(q.field("workspaceId"), workspace._id))
    .first();
  return Boolean(membership);
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
      // Grant only what was actually paid for. expectedUsd is stamped at
      // checkout; older checkouts are re-priced from their base credits.
      let expectedUsd = Number(metadata.expectedUsd);
      if (!Number.isFinite(expectedUsd) || expectedUsd <= 0) {
        try {
          expectedUsd = quoteTopup(base, await getConfigValue(ctx, "creditPriceUsd")).usd;
        } catch {
          expectedUsd = NaN;
        }
      }
      const paidUsd = args.usdTotal;
      let grant = credits;
      let shortfall: string | null = null;
      if (paidUsd === undefined || !Number.isFinite(expectedUsd)) {
        grant = 0;
        shortfall = `top-up payment ${args.paymentId} has no verifiable amount (paid ${paidUsd ?? "?"}, expected ${expectedUsd}) — nothing granted, review and grant by hand`;
      } else if (paidUsd + 0.01 < expectedUsd) {
        grant = Math.max(0, Math.floor((credits * paidUsd) / expectedUsd));
        shortfall = `top-up payment ${args.paymentId} paid $${paidUsd} of $${expectedUsd} — granted ${grant} of ${credits} credits`;
      }
      if (shortfall) {
        console.error("WHOP:", shortfall);
        await recordIncident(ctx, {
          area: "billing",
          source: "whop.handlePaymentSucceeded (topup amount)",
          message: shortfall,
          userId: buyer?._id,
          workspaceId: workspace._id,
        });
      }
      if (grant > 0) {
        await grantCredits(ctx, {
          workspaceId: workspace._id,
          amount: grant,
          feature: "topup",
          description:
            grant < credits
              ? `Credit top-up (${grant.toLocaleString()} of ${credits.toLocaleString()} — partial payment)`
              : bonus > 0
                ? `Credit top-up (${base.toLocaleString()} + ${bonus.toLocaleString()} bonus)`
                : `Credit top-up (${credits.toLocaleString()})`,
          userId: buyer?._id ?? workspace.ownerId,
        });
      }
      await ctx.db.insert("purchases", {
        workspaceId: workspace._id,
        userId: buyer?._id ?? workspace.ownerId,
        kind: "topup",
        amountUsd: paidUsd ?? 0,
        status: "paid",
        whopPaymentId: args.paymentId,
        creditsGranted: grant,
        meta: { whopPaymentId: args.paymentId, credits, baseCredits: base, bonusCredits: bonus, pack, expectedUsd },
      });
      return { handled: grant < credits ? "topup_short" : "topup" };
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
      // A real payment takes the plan back over from any admin-set plan.
      planSource: "whop",
      planSetBy: undefined,
      planSetAt: Date.now(),
      planNote: undefined,
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
      whopPaymentId: args.paymentId,
      creditsGranted: credits,
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
      const selfReferral = referral
        ? await isSelfReferral(ctx, referral.referrerUserId, buyer, workspace)
        : false;
      if (referral && selfReferral) {
        // Kept for the audit trail, never payable.
        await ctx.db.insert("referralCommissions", {
          referralId: referral._id,
          referrerUserId: referral.referrerUserId,
          referredUserId: buyer._id,
          whopPaymentId: args.paymentId,
          kind: firstPayment ? "first" : "renewal",
          plan,
          paymentUsd: priceUsd,
          percent: 0,
          amountUsd: 0,
          status: "void",
          voidReason: "self_referral",
        });
      } else if (referral) {
        const lockedPercent = referral.commissionPercent ?? percent;
        const amountUsd = Math.round(priceUsd * (lockedPercent / 100) * 100) / 100;
        // Held as pending through the refund window, then released to owed.
        const availableAt = Date.now() + COMMISSION_HOLD_MS;
        const commissionId = await ctx.db.insert("referralCommissions", {
          referralId: referral._id,
          referrerUserId: referral.referrerUserId,
          referredUserId: buyer._id,
          whopPaymentId: args.paymentId,
          kind: firstPayment ? "first" : "renewal",
          plan,
          paymentUsd: priceUsd,
          percent: lockedPercent,
          amountUsd,
          status: "pending",
          availableAt,
        });
        await ctx.scheduler.runAt(availableAt, internal.whop.releaseCommission, {
          id: commissionId,
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
          body:
            (firstPayment
              ? `Someone you referred just subscribed. You get ${lockedPercent}% of every renewal for as long as they stay.`
              : `A referral renewed their ${plan} plan — ${lockedPercent}% is yours again.`) +
            " It becomes payable after the 14-day refund window.",
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
    // A plan a superadmin set by hand (comp, partner, invoiced customer)
    // outlives the subscription: forget the dead membership, keep the plan.
    // The referral still churns below — no more invoices will arrive.
    const keepPlan = workspace.planSource === "admin";
    if (keepPlan) {
      await ctx.db.patch(workspace._id, { whopMembershipId: undefined });
    } else {
      await ctx.db.patch(workspace._id, {
        plan: "free",
        planCreditsGrantedFor: undefined,
        whopMembershipId: undefined,
        planSource: undefined,
        planSetBy: undefined,
        planNote: undefined,
      });
    }
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
    if (keepPlan) return { handled: "admin_plan_kept" };
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

/** A held commission clears the refund window and becomes payable. */
export const releaseCommission = internalMutation({
  args: { id: v.id("referralCommissions") },
  handler: async (ctx, args) => {
    const commission = await ctx.db.get(args.id);
    if (!commission || commission.status !== "pending") return;
    await ctx.db.patch(args.id, { status: "owed" });
  },
});

/** The purchase row a Whop payment produced (new rows by index, legacy by meta). */
async function purchaseForPayment(
  ctx: MutationCtx,
  paymentId: string,
  workspaceId: Id<"workspaces"> | null,
): Promise<Doc<"purchases"> | null> {
  const indexed = await ctx.db
    .query("purchases")
    .withIndex("by_whop_payment", (q) => q.eq("whopPaymentId", paymentId))
    .first();
  if (indexed || !workspaceId) return indexed;
  const recent = await ctx.db
    .query("purchases")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .order("desc")
    .take(500);
  return (
    recent.find(
      (p) => (p.meta as { whopPaymentId?: string } | undefined)?.whopPaymentId === paymentId,
    ) ?? null
  );
}

/** Credits a purchase granted; legacy rows fall back to their metadata/config. */
async function creditsGrantedBy(ctx: MutationCtx, purchase: Doc<"purchases">): Promise<number> {
  if (typeof purchase.creditsGranted === "number") return purchase.creditsGranted;
  const meta = (purchase.meta ?? {}) as { credits?: unknown; plan?: unknown };
  if (purchase.kind === "topup") return Math.max(0, Math.round(Number(meta.credits)) || 0);
  if (purchase.kind === "subscription") {
    return await getConfigValue(ctx, meta.plan === "team" ? "teamPlanCredits" : "personalPlanCredits");
  }
  return 0;
}

/**
 * A refunded, voided or disputed payment. The credits that payment granted
 * (top-up pack or plan grant) are clawed back in proportion to the money
 * returned — never below zero — and a plan payment's referral commission is
 * voided. Partial refunds arrive with a cumulative refunded amount, so each
 * new refund claws back only the delta; a dispute counts as the full amount.
 * Plan access itself is still governed by the membership events.
 */
export const handlePaymentRefunded = internalMutation({
  args: {
    eventId: v.string(),
    paymentId: v.string(),
    metadata: v.optional(v.any()),
    usdTotal: v.optional(v.number()),
    /** Cumulative USD refunded on this payment so far (Whop refunded_amount). */
    refundedUsd: v.optional(v.number()),
    kind: v.optional(v.union(v.literal("refund"), v.literal("dispute"))),
  },
  handler: async (ctx, args): Promise<{ handled: string }> => {
    const isDispute = args.kind === "dispute";
    // One clawback per dispute; one per distinct cumulative refund amount.
    const key = isDispute
      ? `dispute:${args.paymentId}`
      : `refund:${args.paymentId}:${args.refundedUsd ?? "full"}`;
    // Refunds handled before partial-refund support were keyed per payment.
    const legacy = await ctx.db
      .query("whopEvents")
      .withIndex("by_key", (q) => q.eq("key", `refund:${args.paymentId}`))
      .first();
    if (legacy || !(await firstTime(ctx, key, isDispute ? "dispute" : "payment.refunded"))) {
      return { handled: "duplicate" };
    }
    const metadata = (args.metadata ?? {}) as Record<string, unknown>;
    const purchase = await purchaseForPayment(
      ctx,
      args.paymentId,
      parseWorkspaceId(ctx, metadata),
    );
    if (!purchase) {
      console.error("WHOP: refund/dispute for unknown payment", args.paymentId);
      return { handled: "unknown_payment" };
    }
    const workspace = await ctx.db.get(purchase.workspaceId);
    if (!workspace) return { handled: "unknown_workspace" };

    const paidUsd = purchase.amountUsd > 0 ? purchase.amountUsd : (args.usdTotal ?? 0);
    const already = purchase.refundedUsd ?? 0;
    const target =
      isDispute || args.refundedUsd === undefined || paidUsd <= 0
        ? paidUsd
        : Math.min(paidUsd, args.refundedUsd);
    const fraction = paidUsd > 0 ? Math.max(0, (target - already) / paidUsd) : already > 0 ? 0 : 1;
    if (fraction <= 0) return { handled: "nothing_new" };
    await ctx.db.patch(purchase._id, {
      refundedUsd: Math.max(already, target),
      ...(target >= paidUsd - 0.005 && { status: "refunded" as const }),
    });

    const granted = await creditsGrantedBy(ctx, purchase);
    const owed = Math.round(granted * Math.min(1, fraction));
    const label = purchase.kind === "topup" ? "credit top-up" : "plan payment";
    const what = isDispute ? "Chargeback" : fraction < 1 ? "Partial refund" : "Refund";
    let removed = 0;
    if (owed > 0) {
      // Whatever was already spent cannot come back; say so on the ledger line.
      const removable = Math.max(0, Math.min(workspace.credits, owed));
      ({ removed } = await clawbackCredits(ctx, {
        workspaceId: workspace._id,
        amount: owed,
        feature: purchase.kind === "topup" ? "topup_refund" : "plan_refund",
        description: `${what} of ${label} (${owed.toLocaleString()} credits${
          removable < owed ? `, ${(owed - removable).toLocaleString()} already spent` : ""
        })`,
        meta: { whopPaymentId: args.paymentId, refundedUsd: target, dispute: isDispute },
      }));
    }

    // The referrer's cut of this payment never becomes payable.
    const commission = await ctx.db
      .query("referralCommissions")
      .withIndex("by_payment", (q) => q.eq("whopPaymentId", args.paymentId))
      .first();
    if (commission && (commission.status === "pending" || commission.status === "owed")) {
      await ctx.db.patch(commission._id, {
        status: "void",
        voidReason: isDispute ? "dispute" : "refund",
      });
      const referral = await ctx.db.get(commission.referralId);
      if (referral) {
        await ctx.db.patch(referral._id, {
          lifetimeUsd: Math.max(
            0,
            Math.round(((referral.lifetimeUsd ?? 0) - commission.amountUsd) * 100) / 100,
          ),
          paymentCount: Math.max(0, (referral.paymentCount ?? 0) - 1),
        });
      }
    } else if (commission && commission.status === "paid") {
      // Already paid out — an admin has to recover it by hand.
      await recordIncident(ctx, {
        area: "billing",
        source: "whop.handlePaymentRefunded (paid commission)",
        message: `${what} on payment ${args.paymentId} whose referral commission ($${commission.amountUsd}) was already paid out`,
        userId: commission.referrerUserId,
        workspaceId: workspace._id,
      });
    }
    if (isDispute) {
      await recordIncident(ctx, {
        area: "billing",
        source: "whop.handlePaymentRefunded (dispute)",
        message: `Chargeback opened on ${label} ${args.paymentId}: ${removed} credits clawed back`,
        workspaceId: workspace._id,
      });
    }

    await notify(ctx, {
      userId: workspace.ownerId,
      workspaceId: workspace._id,
      type: purchase.kind === "topup" ? "topup_refunded" : "plan_refunded",
      title: purchase.kind === "topup" ? "Credit top-up refunded" : "Plan payment refunded",
      body: `${removed.toLocaleString()} credits were removed to match the ${
        isDispute ? "chargeback" : "refund"
      }.`,
      href: "/settings?tab=billing",
    });
    return { handled: purchase.kind === "topup" ? "topup_refunded" : "plan_refunded" };
  },
});
