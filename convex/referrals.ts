import { query } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";
import { getConfigValue } from "./config";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The referrer's dashboard. Commissions are 15% (config referralPercent) of
 * every payment a referred workspace makes, for as long as it keeps renewing:
 * one referralCommissions row per paid invoice. Legacy rows from the old
 * one-time scheme (status qualified/paid, payoutUsd) still count toward
 * lifetime and paid totals.
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const [referrals, commissions, percent] = await Promise.all([
      ctx.db
        .query("referrals")
        .withIndex("by_referrer", (q) => q.eq("referrerUserId", user._id))
        .order("desc")
        .collect(),
      ctx.db
        .query("referralCommissions")
        .withIndex("by_referrer", (q) => q.eq("referrerUserId", user._id))
        .order("desc")
        .collect(),
      getConfigValue(ctx, "referralPercent"),
    ]);

    const rows = await Promise.all(
      referrals.map(async (referral) => {
        const referred = await ctx.db.get(referral.referredUserId);
        const legacyUsd =
          referral.status === "qualified" || referral.status === "paid"
            ? (referral.payoutUsd ?? 0)
            : 0;
        return {
          _id: referral._id,
          _creationTime: referral._creationTime,
          status: referral.status,
          plan: referral.plan,
          commissionPercent: referral.commissionPercent ?? null,
          lifetimeUsd: round2((referral.lifetimeUsd ?? 0) + legacyUsd),
          paymentCount: referral.paymentCount ?? 0,
          lastPaymentAt: referral.lastPaymentAt ?? null,
          referredEmail: referred ? maskEmail(referred.email) : "deleted user",
        };
      }),
    );
    const emailByReferral = new Map(rows.map((r) => [r._id, r.referredEmail]));

    const owedUsd = round2(
      commissions.filter((c) => c.status === "owed").reduce((s, c) => s + c.amountUsd, 0) +
        referrals.filter((r) => r.status === "qualified").reduce((s, r) => s + (r.payoutUsd ?? 0), 0),
    );
    const paidUsd = round2(
      commissions.filter((c) => c.status === "paid").reduce((s, c) => s + c.amountUsd, 0) +
        referrals.filter((r) => r.status === "paid").reduce((s, r) => s + (r.payoutUsd ?? 0), 0),
    );
    // Recurring: the latest commission of each still-active referral — what the
    // next renewal cycle pays if everyone stays.
    const seen = new Set<string>();
    let monthlyUsd = 0;
    const activeIds = new Set(rows.filter((r) => r.status === "active").map((r) => r._id));
    for (const c of commissions) {
      if (!activeIds.has(c.referralId) || seen.has(c.referralId)) continue;
      seen.add(c.referralId);
      monthlyUsd += c.amountUsd;
    }

    return {
      referralCode: user.referralCode,
      percent,
      totalSignups: rows.length,
      active: rows.filter((r) => r.status === "active").length,
      churned: rows.filter((r) => r.status === "churned").length,
      earnedUsd: round2(owedUsd + paidUsd),
      owedUsd,
      paidUsd,
      monthlyUsd: round2(monthlyUsd),
      referrals: rows,
      commissions: commissions.slice(0, 20).map((c) => ({
        _id: c._id,
        _creationTime: c._creationTime,
        kind: c.kind,
        plan: c.plan,
        paymentUsd: c.paymentUsd,
        percent: c.percent,
        amountUsd: c.amountUsd,
        status: c.status,
        referredEmail: emailByReferral.get(c.referralId) ?? "deleted user",
      })),
    };
  },
});

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}
