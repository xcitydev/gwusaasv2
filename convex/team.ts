import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { notify } from "./notifications";

export const members = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return null;
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return {
      plan: workspace.plan,
      isOwner: workspace.ownerId === user._id,
      members: await Promise.all(
        memberships.map(async (m) => {
          const member = await ctx.db.get(m.userId);
          return {
            membershipId: m._id,
            role: m.role,
            name: member?.name,
            email: member?.email ?? "unknown",
            isYou: m.userId === user._id,
          };
        }),
      ),
      pendingInvites: invites
        .filter((i) => i.status === "pending")
        .map((i) => ({ _id: i._id, email: i.email })),
    };
  },
});

export const invite = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    if (workspace.plan !== "team") {
      throw new Error("Team invites need the Team/Agency plan");
    }
    if (workspace.ownerId !== user._id) {
      throw new Error("Only the workspace owner can invite members");
    }
    const email = args.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email");

    const existing = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    if (existing.some((i) => i.workspaceId === workspace._id && i.status === "pending")) {
      throw new Error("That email already has a pending invite");
    }

    const token = generateToken();
    await ctx.db.insert("invites", {
      workspaceId: workspace._id,
      email,
      token,
      invitedBy: user._id,
      status: "pending",
    });
    return token;
  },
});

export const revokeInvite = mutation({
  args: { id: v.id("invites") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const inviteDoc = await ctx.db.get(args.id);
    if (!inviteDoc || inviteDoc.workspaceId !== workspace?._id) return;
    if (workspace.ownerId !== user._id) throw new Error("Owner only");
    await ctx.db.patch(args.id, { status: "revoked" });
  },
});

export const removeMember = mutation({
  args: { membershipId: v.id("members") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace || workspace.ownerId !== user._id) {
      throw new Error("Only the workspace owner can remove members");
    }
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.workspaceId !== workspace._id) return;
    if (membership.role === "owner") throw new Error("The owner can't be removed");
    await ctx.db.delete(args.membershipId);
  },
});

/** Invitee opens /invite/[token] while signed in. */
export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const inviteDoc = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!inviteDoc || inviteDoc.status !== "pending") {
      throw new Error("This invite is no longer valid");
    }
    const already = await ctx.db
      .query("members")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", inviteDoc.workspaceId).eq("userId", user._id),
      )
      .unique();
    if (!already) {
      await ctx.db.insert("members", {
        workspaceId: inviteDoc.workspaceId,
        userId: user._id,
        role: "member",
      });
    }
    await ctx.db.patch(inviteDoc._id, { status: "accepted" });
    const workspace = await ctx.db.get(inviteDoc.workspaceId);
    await notify(ctx, {
      userId: inviteDoc.invitedBy,
      type: "invite_accepted",
      title: `${user.name ?? user.email} joined your team`,
      href: "/team",
    });
    return workspace?.name ?? "the team";
  },
});

function generateToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "";
  for (let i = 0; i < 24; i++) {
    token += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return token;
}
