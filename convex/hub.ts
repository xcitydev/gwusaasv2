import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, getPrimaryWorkspace, requireUser } from "./lib/auth";

/**
 * The AI Hub conversation, one thread per user per workspace, saved as the
 * UI message list the chat renders from (plus the plan-card → generation
 * map so result cards survive a refresh). Kept small: the client trims to
 * the last 40 messages before saving.
 */

const MAX_BYTES = 400_000;

export const getThread = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return null;
    const thread = await ctx.db
      .query("hubThreads")
      .withIndex("by_user_workspace", (q) =>
        q.eq("userId", user._id).eq("workspaceId", workspace._id),
      )
      .unique();
    return thread
      ? { messages: thread.messages as unknown[], jobs: (thread.jobs ?? {}) as Record<string, string> }
      : { messages: [], jobs: {} };
  },
});

export const saveThread = mutation({
  args: { messages: v.any(), jobs: v.any() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    if (JSON.stringify(args.messages).length > MAX_BYTES) {
      throw new Error("Thread too large to save");
    }
    const existing = await ctx.db
      .query("hubThreads")
      .withIndex("by_user_workspace", (q) =>
        q.eq("userId", user._id).eq("workspaceId", workspace._id),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        messages: args.messages,
        jobs: args.jobs,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("hubThreads", {
        userId: user._id,
        workspaceId: workspace._id,
        messages: args.messages,
        jobs: args.jobs,
        updatedAt: Date.now(),
      });
    }
  },
});
