import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, getPrimaryWorkspace, hasFormsAccess } from "./lib/auth";

/**
 * Idempotent sign-in hook: called from the client once a Clerk session exists.
 * Creates the user + personal workspace on first sign-in, syncs profile after.
 */
export const ensureUser = mutation({
  args: {
    // Referral code captured from ?ref= on first visit, if any.
    referralCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    const email = identity.email ?? "";
    const name = identity.name ?? identity.givenName ?? undefined;
    const imageUrl = identity.pictureUrl ?? undefined;

    if (existing) {
      if (
        existing.email !== email ||
        existing.name !== name ||
        existing.imageUrl !== imageUrl
      ) {
        await ctx.db.patch(existing._id, { email, name, imageUrl });
      }
      return existing._id;
    }

    // Resolve referrer before creating so a bad code can't block signup.
    let referredBy = undefined;
    if (args.referralCode) {
      const referrer = await ctx.db
        .query("users")
        .withIndex("by_referral_code", (q) =>
          q.eq("referralCode", args.referralCode!),
        )
        .unique();
      if (referrer) referredBy = referrer._id;
    }

    const userId = await ctx.db.insert("users", {
      clerkId: identity.subject,
      email,
      name,
      imageUrl,
      status: "active",
      referralCode: generateReferralCode(),
      referredBy,
    });

    if (referredBy) {
      await ctx.db.insert("referrals", {
        referrerUserId: referredBy,
        referredUserId: userId,
        status: "pending",
      });
    }

    const workspaceId = await ctx.db.insert("workspaces", {
      name: name ? `${name}'s workspace` : "My workspace",
      ownerId: userId,
      plan: "free",
      credits: 0,
    });
    await ctx.db.insert("members", {
      workspaceId,
      userId,
      role: "owner",
    });

    return userId;
  },
});

/** Everything the app shell needs about the signed-in user, in one query. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      imageUrl: user.imageUrl,
      adminRole: user.adminRole,
      status: user.status,
      referralCode: user.referralCode,
      // Invite-only GWU Onboarding Forms.
      formsAccess: hasFormsAccess(user),
      formsAccessSource: user.formsAccessSource,
      workspace: workspace
        ? {
            _id: workspace._id,
            name: workspace.name,
            plan: workspace.plan,
            credits: workspace.credits,
            isOwner: workspace.ownerId === user._id,
          }
        : null,
    };
  },
});

function generateReferralCode(): string {
  // Convex's Math.random is deterministic per-mutation, which is fine here.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}
