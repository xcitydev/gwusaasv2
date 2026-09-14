import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUser, requireAdmin, getAdminOrNull } from "./lib/auth";
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
    const referrals = await ctx.db.query("referrals").collect();
    const payoutsOwed = referrals
      .filter((r) => r.status === "qualified")
      .reduce((sum, r) => sum + (r.payoutUsd ?? 0), 0);
    const payoutsPaid = referrals
      .filter((r) => r.status === "paid")
      .reduce((sum, r) => sum + (r.payoutUsd ?? 0), 0);
    return { total, byKind, payoutsOwed, payoutsPaid, purchaseCount: paid.length };
  },
});
