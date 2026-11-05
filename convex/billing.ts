import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, getPrimaryWorkspace } from "./lib/auth";

// Plan state has exactly one writer: signature-verified Whop webhooks
// (convex/whop.ts). The old client-reported Clerk Billing sync (syncPlan)
// was removed — a browser could claim any plan and re-collect plan credits.

const LEDGER_PAGE_SIZE = 10;
// Numbered pagination needs a total; cap the count so one huge ledger can't
// make this query heavy. 1000 entries = 100 pages — plenty of history.
const LEDGER_MAX_ROWS = 1000;

export const ledger = query({
  args: { page: v.number() },
  handler: async (ctx, args) => {
    const empty = { rows: [], total: 0, pageSize: LEDGER_PAGE_SIZE };
    const user = await getCurrentUser(ctx);
    if (!user) return empty;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return empty;
    const all = await ctx.db
      .query("creditLedger")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(LEDGER_MAX_ROWS);
    const start = Math.max(0, Math.floor(args.page)) * LEDGER_PAGE_SIZE;
    return {
      rows: all.slice(start, start + LEDGER_PAGE_SIZE),
      total: all.length,
      pageSize: LEDGER_PAGE_SIZE,
    };
  },
});

export const topUp = mutation({
  args: { credits: v.number() },
  handler: async () => {
    // Top-ups go through Stripe checkout alongside Clerk Billing — wired in
    // when payment keys are added. Until then this is a clear error.
    throw new Error("NOT_CONFIGURED: Credit top-ups activate with billing keys.");
  },
});
