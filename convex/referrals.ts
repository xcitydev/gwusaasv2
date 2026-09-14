import { query } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";
import { getConfigValue } from "./config";

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const referrals = await ctx.db
      .query("referrals")
      .withIndex("by_referrer", (q) => q.eq("referrerUserId", user._id))
      .order("desc")
      .collect();
    const percent = await getConfigValue(ctx, "referralPercent");
    const rows = await Promise.all(
      referrals.map(async (referral) => {
        const referred = await ctx.db.get(referral.referredUserId);
        return {
          _id: referral._id,
          _creationTime: referral._creationTime,
          status: referral.status,
          plan: referral.plan,
          payoutUsd: referral.payoutUsd,
          referredEmail: referred ? maskEmail(referred.email) : "deleted user",
        };
      }),
    );
    return {
      referralCode: user.referralCode,
      percent,
      totalSignups: rows.length,
      qualified: rows.filter((r) => r.status === "qualified").length,
      earnedUsd: rows
        .filter((r) => r.status === "qualified" || r.status === "paid")
        .reduce((sum, r) => sum + (r.payoutUsd ?? 0), 0),
      paidUsd: rows
        .filter((r) => r.status === "paid")
        .reduce((sum, r) => sum + (r.payoutUsd ?? 0), 0),
      referrals: rows,
    };
  },
});

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}
