import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Not authenticated");
  if (user.status === "locked") throw new Error("Account locked");
  return user;
}

/** GWU Onboarding Forms are invite-only; admins always see them. */
export function hasFormsAccess(user: Doc<"users">): boolean {
  return Boolean(user.formsAccess) || Boolean(user.adminRole);
}

export async function requireFormsAccess(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (!hasFormsAccess(user)) {
    throw new Error(
      "GWU Onboarding Forms are invite-only. Enter your invite code in Settings or ask the team for access.",
    );
  }
  return user;
}

const ADMIN_RANK = { regular: 1, dev: 2, super: 3 } as const;
export type AdminRole = keyof typeof ADMIN_RANK;

export async function requireAdmin(
  ctx: Ctx,
  minimum: AdminRole = "regular",
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (!user.adminRole || ADMIN_RANK[user.adminRole] < ADMIN_RANK[minimum]) {
    throw new Error("Admin access required");
  }
  return user;
}

/**
 * Query-side variant: return null instead of throwing so admin pages can
 * render an access-denied state (and dev preview doesn't crash) instead of
 * hitting an error boundary.
 */
export async function getAdminOrNull(
  ctx: Ctx,
  minimum: AdminRole = "regular",
): Promise<Doc<"users"> | null> {
  const user = await getCurrentUser(ctx);
  if (!user || user.status === "locked") return null;
  if (!user.adminRole || ADMIN_RANK[user.adminRole] < ADMIN_RANK[minimum]) {
    return null;
  }
  return user;
}

/** The workspace a user acts in (owner first, then first membership). */
export async function getPrimaryWorkspace(
  ctx: Ctx,
  userId: Doc<"users">["_id"],
): Promise<Doc<"workspaces"> | null> {
  // Joining a team makes THAT workspace primary — members share the owner's
  // leads, inboxes, campaigns and credits (the point of the Team plan). The
  // personal workspace auto-created at signup is only the fallback.
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  let ownFallback: Doc<"workspaces"> | null = null;
  // Most recently joined team wins.
  for (const membership of [...memberships].reverse()) {
    const workspace = await ctx.db.get(membership.workspaceId);
    if (!workspace) continue;
    if (workspace.ownerId !== userId) return workspace;
    ownFallback = workspace;
  }
  if (ownFallback) return ownFallback;
  // Legacy safety: an owner without a members row.
  return await ctx.db
    .query("workspaces")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .first();
}
