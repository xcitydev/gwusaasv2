import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

/**
 * All credit movement goes through these two helpers so the workspace balance
 * and the ledger can never drift apart (Convex mutations are transactional).
 */

export async function grantCredits(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    amount: number;
    feature: string;
    description: string;
    userId?: Id<"users">;
    meta?: unknown;
  },
): Promise<number> {
  if (args.amount <= 0) throw new Error("Grant amount must be positive");
  const workspace = await mustGetWorkspace(ctx, args.workspaceId);
  const balanceAfter = workspace.credits + args.amount;
  await ctx.db.patch(workspace._id, { credits: balanceAfter });
  await ctx.db.insert("creditLedger", {
    workspaceId: workspace._id,
    userId: args.userId,
    amount: args.amount,
    balanceAfter,
    feature: args.feature,
    description: args.description,
    meta: args.meta,
  });
  return balanceAfter;
}

export async function spendCredits(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    amount: number;
    feature: string;
    description: string;
    userId?: Id<"users">;
    meta?: unknown;
  },
): Promise<number> {
  if (args.amount <= 0) throw new Error("Spend amount must be positive");
  const workspace = await mustGetWorkspace(ctx, args.workspaceId);
  if (workspace.credits < args.amount) {
    // The numbers let the client open the top-up prompt with the exact gap.
    throw new Error(
      `INSUFFICIENT_CREDITS: need ${Math.ceil(args.amount)}, have ${Math.floor(workspace.credits)}`,
    );
  }
  const balanceAfter = workspace.credits - args.amount;
  await ctx.db.patch(workspace._id, { credits: balanceAfter });
  await ctx.db.insert("creditLedger", {
    workspaceId: workspace._id,
    userId: args.userId,
    amount: -args.amount,
    balanceAfter,
    feature: args.feature,
    description: args.description,
    meta: args.meta,
  });
  return balanceAfter;
}

/**
 * Take credits back after a refund, never below zero. Unlike spendCredits
 * this never throws on a short balance: the refund already happened on Whop,
 * so we remove what is left and record the rest in the ledger line.
 */
export async function clawbackCredits(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    amount: number;
    feature: string;
    description: string;
    userId?: Id<"users">;
    meta?: unknown;
  },
): Promise<{ removed: number; balanceAfter: number }> {
  const workspace = await mustGetWorkspace(ctx, args.workspaceId);
  const removed = Math.max(0, Math.min(workspace.credits, Math.round(args.amount)));
  const balanceAfter = workspace.credits - removed;
  await ctx.db.patch(workspace._id, { credits: balanceAfter });
  await ctx.db.insert("creditLedger", {
    workspaceId: workspace._id,
    userId: args.userId,
    amount: -removed,
    balanceAfter,
    feature: args.feature,
    description: args.description,
    meta: args.meta,
  });
  return { removed, balanceAfter };
}

async function mustGetWorkspace(
  ctx: MutationCtx,
  id: Id<"workspaces">,
): Promise<Doc<"workspaces">> {
  const workspace = await ctx.db.get(id);
  if (!workspace) throw new Error("Workspace not found");
  return workspace;
}
