import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/auth";

/**
 * Fixed-window rate limiter: one row per key, counting hits inside the
 * current window. Runs inside the caller's mutation, so the check and the
 * increment are one transaction (two concurrent hits can't both slip past).
 */

export const RATE_LIMITED = "RATE_LIMITED";

/** Per-user budgets for the expensive AI entry points. */
export const LIMITS = {
  enhancePrompt: { limit: 20, windowMs: 10 * 60_000 },
  audit: { limit: 10, windowMs: 60 * 60_000 },
  hubChat: { limit: 60, windowMs: 60 * 60_000 },
  supportChat: { limit: 30, windowMs: 60 * 60_000 },
} as const;

export type LimitName = keyof typeof LIMITS;

export async function checkRateLimit(
  ctx: MutationCtx,
  args: { key: string; limit: number; windowMs: number },
): Promise<void> {
  const now = Date.now();
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", args.key))
    .unique();
  if (!row || now - row.windowStart >= args.windowMs) {
    if (row) await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    else await ctx.db.insert("rateLimits", { key: args.key, windowStart: now, count: 1 });
    return;
  }
  if (row.count >= args.limit) {
    const minutes = Math.max(1, Math.ceil((row.windowStart + args.windowMs - now) / 60_000));
    throw new Error(
      `${RATE_LIMITED}: You're going a bit fast — try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }
  await ctx.db.patch(row._id, { count: row.count + 1 });
}

/** Rate-limit a named bucket for the signed-in user (key derived server-side). */
export async function hitForUser(ctx: MutationCtx, name: LimitName): Promise<void> {
  const user = await requireUser(ctx);
  await checkRateLimit(ctx, { key: `${name}:${user._id}`, ...LIMITS[name] });
}

/** For actions: `await ctx.runMutation(internal.rateLimits.hit, {...})`. */
export const hit = internalMutation({
  args: { key: v.string(), limit: v.number(), windowMs: v.number() },
  handler: async (ctx, args) => {
    await checkRateLimit(ctx, args);
  },
});

/** For actions acting as the caller: the key comes from the identity, never the client. */
export const hitNamed = internalMutation({
  args: {
    name: v.union(
      v.literal("enhancePrompt"),
      v.literal("audit"),
      v.literal("hubChat"),
      v.literal("supportChat"),
    ),
  },
  handler: async (ctx, args) => {
    await hitForUser(ctx, args.name);
  },
});

/**
 * Called by the Next API chat routes with the caller's Clerk→Convex token.
 * Only the bucket is chosen by the route; the key is the caller's user id.
 */
export const hitChat = mutation({
  args: { bucket: v.union(v.literal("hubChat"), v.literal("supportChat")) },
  handler: async (ctx, args) => {
    await hitForUser(ctx, args.bucket);
    return { ok: true };
  },
});
