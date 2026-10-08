import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireUser, requireAdmin, getAdminOrNull, hasFormsAccess } from "./lib/auth";
import { grantCredits, spendCredits } from "./lib/credits";
import { adminRoleValidator } from "./schema";
import { notify } from "./notifications";

export const overview = query({
  args: {},
  handler: async (ctx) => {
    if (!(await getAdminOrNull(ctx, "regular"))) return null;
    const [users, openTickets, processingForms, workspaces] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db
        .query("tickets")
        .withIndex("by_status", (q) => q.eq("status", "open"))
        .collect(),
      ctx.db
        .query("formSubmissions")
        .withIndex("by_status", (q) => q.eq("status", "processing"))
        .collect(),
      ctx.db.query("workspaces").collect(),
    ]);
    return {
      totalUsers: users.length,
      admins: users.filter((u) => u.adminRole).length,
      openTickets: openTickets.length,
      processingForms: processingForms.length,
      paidWorkspaces: workspaces.filter((w) => w.plan !== "free").length,
    };
  },
});

export const listUsers = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!(await getAdminOrNull(ctx, "regular"))) return [];
    let users = await ctx.db.query("users").order("desc").take(200);
    const search = args.search?.trim().toLowerCase();
    if (search) {
      users = users.filter(
        (u) =>
          u.email.toLowerCase().includes(search) ||
          (u.name ?? "").toLowerCase().includes(search),
      );
    }
    return await Promise.all(
      users.map(async (u) => {
        const workspace = await ctx.db
          .query("workspaces")
          .withIndex("by_owner", (q) => q.eq("ownerId", u._id))
          .first();
        return {
          _id: u._id,
          _creationTime: u._creationTime,
          email: u.email,
          name: u.name,
          status: u.status,
          adminRole: u.adminRole,
          formsAccess: hasFormsAccess(u),
          formsAccessSource: u.formsAccessSource,
          plan: workspace?.plan ?? "free",
          credits: workspace?.credits ?? 0,
          workspaceId: workspace?._id,
        };
      }),
    );
  },
});

export const setUserStatus = mutation({
  args: {
    userId: v.id("users"),
    status: v.union(v.literal("active"), v.literal("locked")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "super");
    if (args.userId === admin._id) throw new Error("You can't lock yourself");
    await ctx.db.patch(args.userId, { status: args.status });
  },
});

export const adjustCredits = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    amount: v.number(), // positive grants, negative removes
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "super");
    if (args.amount === 0) throw new Error("Amount can't be zero");
    if (args.amount > 0) {
      await grantCredits(ctx, {
        workspaceId: args.workspaceId,
        amount: args.amount,
        feature: "admin_adjustment",
        description: args.reason || `Granted by ${admin.email}`,
        userId: admin._id,
      });
    } else {
      await spendCredits(ctx, {
        workspaceId: args.workspaceId,
        amount: -args.amount,
        feature: "admin_adjustment",
        description: args.reason || `Removed by ${admin.email}`,
        userId: admin._id,
      });
    }
  },
});

// ── Admin role management (superadmin) ──────────────────────────────────

export const listAdmins = query({
  args: {},
  handler: async (ctx) => {
    if (!(await getAdminOrNull(ctx, "regular"))) return [];
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u.adminRole)
      .map((u) => ({
        _id: u._id,
        email: u.email,
        name: u.name,
        adminRole: u.adminRole,
      }));
  },
});

export const setAdminRole = mutation({
  args: {
    email: v.string(),
    role: v.union(adminRoleValidator, v.null()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "super");
    const target = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .unique();
    if (!target) throw new Error("No user with that email");
    if (target._id === admin._id && args.role !== "super") {
      throw new Error("You can't demote yourself");
    }
    await ctx.db.patch(target._id, { adminRole: args.role ?? undefined });
    if (args.role) {
      await notify(ctx, {
        userId: target._id,
        type: "admin_role",
        title: `You are now a ${args.role} admin`,
        href: "/admin",
      });
    }
  },
});

/**
 * One-time bootstrap: when no admin exists yet, the signed-in user can claim
 * superadmin. Safe because it's a no-op the moment any admin exists.
 */
export const bootstrapSuper = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const users = await ctx.db.query("users").collect();
    if (users.some((u) => u.adminRole)) {
      throw new Error("An admin already exists");
    }
    await ctx.db.patch(user._id, { adminRole: "super" });
  },
});

export const hasAnyAdmin = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.some((u) => u.adminRole);
  },
});

// ── Revenue (superadmin) ────────────────────────────────────────────────

export const revenue = query({
  args: {},
  handler: async (ctx) => {
    if (!(await getAdminOrNull(ctx, "super"))) return null;
    const purchases = await ctx.db.query("purchases").collect();
    const paid = purchases.filter((p) => p.status === "paid");
    const byKind: Record<string, number> = {};
    let total = 0;
    for (const p of paid) {
      byKind[p.kind] = (byKind[p.kind] ?? 0) + p.amountUsd;
      total += p.amountUsd;
    }
    // Referral payouts: per-invoice commissions (15% for life) plus any legacy
    // one-time payouts still sitting on old referral rows.
    const [referrals, commissions] = await Promise.all([
      ctx.db.query("referrals").collect(),
      ctx.db.query("referralCommissions").collect(),
    ]);
    const payoutsOwed =
      commissions.filter((c) => c.status === "owed").reduce((sum, c) => sum + c.amountUsd, 0) +
      referrals.filter((r) => r.status === "qualified").reduce((sum, r) => sum + (r.payoutUsd ?? 0), 0);
    const payoutsPaid =
      commissions.filter((c) => c.status === "paid").reduce((sum, c) => sum + c.amountUsd, 0) +
      referrals.filter((r) => r.status === "paid").reduce((sum, r) => sum + (r.payoutUsd ?? 0), 0);
    return { total, byKind, payoutsOwed, payoutsPaid, purchaseCount: paid.length };
  },
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Referral payouts grouped by referrer: what each person is owed right now
 * (per-invoice commissions plus any legacy one-time payout still unpaid),
 * what they have been paid, and how many referrals are still paying.
 */
export const referralPayouts = query({
  args: {},
  handler: async (ctx) => {
    if (!(await getAdminOrNull(ctx, "super"))) return null;
    const [commissions, referrals] = await Promise.all([
      ctx.db.query("referralCommissions").collect(),
      ctx.db.query("referrals").collect(),
    ]);
    const byReferrer = new Map<
      string,
      { owedUsd: number; owedCount: number; paidUsd: number; activeReferrals: number; lastOwedAt: number | null }
    >();
    const bucket = (id: string) => {
      let b = byReferrer.get(id);
      if (!b) {
        b = { owedUsd: 0, owedCount: 0, paidUsd: 0, activeReferrals: 0, lastOwedAt: null };
        byReferrer.set(id, b);
      }
      return b;
    };
    for (const c of commissions) {
      const b = bucket(c.referrerUserId);
      if (c.status === "owed") {
        b.owedUsd += c.amountUsd;
        b.owedCount++;
        b.lastOwedAt = Math.max(b.lastOwedAt ?? 0, c._creationTime);
      } else b.paidUsd += c.amountUsd;
    }
    for (const r of referrals) {
      const b = bucket(r.referrerUserId);
      if (r.status === "active") b.activeReferrals++;
      if (r.status === "qualified") {
        b.owedUsd += r.payoutUsd ?? 0;
        b.owedCount++;
        b.lastOwedAt = Math.max(b.lastOwedAt ?? 0, r._creationTime);
      }
      if (r.status === "paid") b.paidUsd += r.payoutUsd ?? 0;
    }
    const rows = await Promise.all(
      [...byReferrer.entries()].map(async ([userId, b]) => {
        const user = await ctx.db.get(userId as Id<"users">);
        return {
          userId: userId as Id<"users">,
          email: user?.email ?? "deleted user",
          name: user?.name ?? null,
          owedUsd: round2(b.owedUsd),
          owedCount: b.owedCount,
          paidUsd: round2(b.paidUsd),
          activeReferrals: b.activeReferrals,
          lastOwedAt: b.lastOwedAt,
        };
      }),
    );
    return rows
      .filter((r) => r.owedUsd > 0 || r.paidUsd > 0)
      .sort((a, b) => b.owedUsd - a.owedUsd || b.paidUsd - a.paidUsd);
  },
});

/**
 * Record that a referrer has been paid everything currently owed (the money
 * itself moves outside the app). Every owed commission and any legacy
 * qualified referral flips to paid; the referrer is notified with the total.
 */
export const markReferralPayoutsPaid = mutation({
  args: { referrerUserId: v.id("users") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "super");
    const now = Date.now();
    let total = 0;
    let count = 0;
    const owed = await ctx.db
      .query("referralCommissions")
      .withIndex("by_referrer", (q) => q.eq("referrerUserId", args.referrerUserId))
      .collect();
    for (const c of owed) {
      if (c.status !== "owed") continue;
      await ctx.db.patch(c._id, { status: "paid", paidAt: now });
      total += c.amountUsd;
      count++;
    }
    const legacy = await ctx.db
      .query("referrals")
      .withIndex("by_referrer", (q) => q.eq("referrerUserId", args.referrerUserId))
      .collect();
    for (const r of legacy) {
      if (r.status !== "qualified") continue;
      await ctx.db.patch(r._id, { status: "paid" });
      total += r.payoutUsd ?? 0;
      count++;
    }
    if (count === 0) throw new Error("Nothing is owed to this referrer.");
    total = round2(total);
    await notify(ctx, {
      userId: args.referrerUserId,
      type: "referral_paid",
      title: `Referral payout sent: $${total}`,
      body: `${count} commission${count === 1 ? "" : "s"} marked paid by ${admin.name ?? "the Creatily team"}.`,
      href: "/referrals",
    });
    return { total, count };
  },
});
