import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, getPrimaryWorkspace } from "./lib/auth";

// Plan state has exactly one writer: signature-verified Whop webhooks
// (convex/whop.ts). The old client-reported Clerk Billing sync (syncPlan)
// was removed — a browser could claim any plan and re-collect plan credits.

// Inert stub kept only so stale client bundles (old tabs, un-redeployed
// frontends) that still call billing:syncPlan don't log "Could not find
// public function". It never reads or writes anything. Safe to delete once
// every deployed frontend is past commit 22bbfd4.
export const syncPlan = mutation({
  args: { plan: v.optional(v.any()) },
  handler: async () => ({ changed: false }),
});

const LEDGER_PAGE_SIZE = 10;
// Numbered pagination needs a total; cap the count so one huge ledger can't
// make this query heavy. 1000 entries = 100 pages — plenty of history.
const LEDGER_MAX_ROWS = 1000;

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function publicLedgerDescription(
  feature: string | undefined,
  description: string,
  amount: number,
): string {
  if (feature !== "admin_adjustment") return description;
  if (/^(Granted|Removed) by /.test(description) || EMAIL_RE.test(description)) {
    return amount > 0 ? "Bonus credits" : "Credit adjustment";
  }
  return description;
}

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
      // Only what the history table shows — never the acting admin's id, and
      // never their email (older admin grants stored "Granted by <email>").
      rows: all.slice(start, start + LEDGER_PAGE_SIZE).map((e) => ({
        _id: e._id,
        _creationTime: e._creationTime,
        amount: e.amount,
        balanceAfter: e.balanceAfter,
        description: publicLedgerDescription(e.feature, e.description, e.amount),
      })),
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
