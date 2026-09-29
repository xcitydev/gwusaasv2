import { query, mutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireUser } from "./lib/auth";
import type { Id } from "./_generated/dataModel";

/**
 * Guided product tours — per-user progress so a walkthrough auto-starts the
 * first time someone opens a feature, resumes where they left it, and never
 * comes back after Finish or Skip (until they press "Show me around").
 */

async function progressRow(ctx: QueryCtx, userId: Id<"users">, tourId: string) {
  return await ctx.db
    .query("tourProgress")
    .withIndex("by_user_tour", (q) => q.eq("userId", userId).eq("tourId", tourId))
    .first();
}

/** null = signed out (show nothing); {seen:false} = auto-start from step. */
export const myProgress = query({
  args: { tourId: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const row = await progressRow(ctx, user._id, args.tourId);
    return {
      step: row?.step ?? 0,
      seen: Boolean(row?.completedAt || row?.skippedAt),
      started: Boolean(row),
    };
  },
});

/** Remember the step reached, so leaving mid-tour resumes there. */
export const setStep = mutation({
  args: { tourId: v.string(), step: v.number() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const step = Math.max(0, Math.round(args.step));
    const row = await progressRow(ctx, user._id, args.tourId);
    if (row) {
      await ctx.db.patch(row._id, {
        step,
        completedAt: undefined,
        skippedAt: undefined,
      });
    } else {
      await ctx.db.insert("tourProgress", {
        userId: user._id,
        tourId: args.tourId,
        step,
      });
    }
  },
});

export const finish = mutation({
  args: { tourId: v.string(), skipped: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const done = args.skipped
      ? { skippedAt: Date.now(), completedAt: undefined }
      : { completedAt: Date.now(), skippedAt: undefined };
    const row = await progressRow(ctx, user._id, args.tourId);
    if (row) await ctx.db.patch(row._id, done);
    else {
      await ctx.db.insert("tourProgress", {
        userId: user._id,
        tourId: args.tourId,
        step: 0,
        ...done,
      });
    }
  },
});

/** "Show me around" — run the walkthrough again from the top. */
export const restart = mutation({
  args: { tourId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await progressRow(ctx, user._id, args.tourId);
    if (row) {
      await ctx.db.patch(row._id, {
        step: 0,
        completedAt: undefined,
        skippedAt: undefined,
      });
    } else {
      await ctx.db.insert("tourProgress", {
        userId: user._id,
        tourId: args.tourId,
        step: 0,
      });
    }
  },
});
