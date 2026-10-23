import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAdminOrNull, requireAdmin } from "./lib/auth";
import { notify } from "./notifications";
import { toPublicError, type ErrorArea } from "../lib/public-errors";

const ADMIN_ROLES = ["regular", "dev", "super"] as const;

/**
 * Record a failure that was hidden from a user. Repeats of the same failure
 * while it is still open bump a counter instead of spamming admins; the bell
 * rings once per new (or re-opened) incident.
 */
export async function recordIncident(
  ctx: MutationCtx,
  args: {
    area: string;
    vendor?: string;
    source: string;
    message: string;
    userId?: Id<"users">;
    workspaceId?: Id<"workspaces">;
  },
) {
  const message = args.message.slice(0, 2000);
  // Strip ids/numbers so "call abc123 failed" and "call def456 failed" group.
  const fingerprint = `${args.source}|${args.vendor ?? args.area}|${message
    .slice(0, 160)
    .replace(/[0-9a-f]{8,}|\d+/gi, "#")}`;
  const now = Date.now();
  const open = await ctx.db
    .query("incidents")
    .withIndex("by_fingerprint_status", (q) =>
      q.eq("fingerprint", fingerprint).eq("status", "open"),
    )
    .first();
  if (open) {
    await ctx.db.patch(open._id, {
      count: open.count + 1,
      lastAt: now,
      message,
      ...(args.userId && { userId: args.userId }),
      ...(args.workspaceId && { workspaceId: args.workspaceId }),
    });
    return;
  }
  await ctx.db.insert("incidents", {
    fingerprint,
    area: args.area,
    vendor: args.vendor,
    source: args.source,
    message,
    userId: args.userId,
    workspaceId: args.workspaceId,
    count: 1,
    lastAt: now,
    status: "open",
  });
  for (const role of ADMIN_ROLES) {
    const admins = await ctx.db
      .query("users")
      .withIndex("by_admin_role", (q) => q.eq("adminRole", role))
      .collect();
    for (const admin of admins) {
      await notify(ctx, {
        userId: admin._id,
        type: "incident",
        title: `A user hit an error in ${args.area}${args.vendor ? ` (${args.vendor})` : ""}`,
        body: message.slice(0, 240),
        href: "/admin/incidents",
      });
    }
  }
}

/**
 * For errors saved onto a row the user will see later (failed generation,
 * search, transcript…): returns the text safe to store, and files an
 * incident when the raw text had to be hidden.
 */
export async function publicRowError(
  ctx: MutationCtx,
  raw: string | undefined,
  opts: {
    source: string;
    area: ErrorArea;
    userId?: Id<"users">;
    workspaceId?: Id<"workspaces">;
  },
): Promise<string | undefined> {
  if (!raw) return raw;
  const pub = toPublicError(raw, opts.area);
  if (pub.hidden) {
    console.error(`[incident] ${opts.source}:`, raw);
    await recordIncident(ctx, {
      area: pub.area,
      vendor: pub.vendor,
      source: opts.source,
      message: raw,
      userId: opts.userId,
      workspaceId: opts.workspaceId,
    });
  }
  return pub.message;
}

export const record = internalMutation({
  args: {
    area: v.string(),
    vendor: v.optional(v.string()),
    source: v.string(),
    message: v.string(),
    userId: v.optional(v.id("users")),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, args) => {
    // Actions pass the caller's identity through, so attribute when we can.
    let userId = args.userId;
    if (!userId) {
      const identity = await ctx.auth.getUserIdentity();
      if (identity) {
        const user = await ctx.db
          .query("users")
          .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
          .unique();
        userId = user?._id;
      }
    }
    await recordIncident(ctx, { ...args, userId });
  },
});

export const list = query({
  args: { status: v.optional(v.union(v.literal("open"), v.literal("resolved"))) },
  handler: async (ctx, args) => {
    const admin = await getAdminOrNull(ctx);
    if (!admin) return null;
    const rows = await ctx.db
      .query("incidents")
      .withIndex("by_status_last", (q) => q.eq("status", args.status ?? "open"))
      .order("desc")
      .take(200);
    return await Promise.all(
      rows.map(async (r) => {
        const user = r.userId ? await ctx.db.get(r.userId) : null;
        return { ...r, userEmail: user?.email, userName: user?.name };
      }),
    );
  },
});

export const openCount = query({
  args: {},
  handler: async (ctx) => {
    const admin = await getAdminOrNull(ctx);
    if (!admin) return null;
    const rows = await ctx.db
      .query("incidents")
      .withIndex("by_status_last", (q) => q.eq("status", "open"))
      .take(500);
    return rows.length;
  },
});

export const resolve = mutation({
  args: { id: v.id("incidents") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.patch(args.id, { status: "resolved" });
  },
});

export const resolveAll = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("incidents")
      .withIndex("by_status_last", (q) => q.eq("status", "open"))
      .take(500);
    await Promise.all(rows.map((r) => ctx.db.patch(r._id, { status: "resolved" })));
    return rows.length;
  },
});
