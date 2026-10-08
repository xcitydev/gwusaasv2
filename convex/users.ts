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

    // Account adoption: the same person arriving with a new Clerk subject —
    // the test → production Clerk cutover, or a re-created Clerk account.
    // A verified email is the only link we trust; it keeps their workspace,
    // credits, plan and history instead of minting a fresh empty account.
    // Exactly one match is required so an ambiguous email never adopts.
    if (email && identity.emailVerified === true) {
      const byEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect();
      if (byEmail.length === 1) {
        const adopted = byEmail[0];
        await ctx.db.patch(adopted._id, {
          clerkId: identity.subject,
          name: name ?? adopted.name,
          imageUrl: imageUrl ?? adopted.imageUrl,
        });
        console.log(
          `ensureUser: adopted user ${adopted._id} (clerk ${adopted.clerkId} → ${identity.subject})`,
        );
        return adopted._id;
      }
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
      planQuizPending: true,
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
      // New sign-ups are routed to /welcome once; admins never are.
      planQuizPending: Boolean(user.planQuizPending) && !user.adminRole,
      planQuiz: user.planQuiz ?? null,
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

const QUIZ_AUDIENCES = ["business", "agency", "creator", "sales"] as const;
const QUIZ_TEAM_SIZES = ["solo", "small", "large"] as const;
const QUIZ_GOALS = ["leads", "calls", "dms", "notes", "studio", "voice"] as const;

/**
 * Save the /welcome plan quiz (or a skip) and return the recommended plan.
 * Agencies and anyone with a team get Team; everyone else gets Personal.
 */
export const savePlanQuiz = mutation({
  args: {
    audience: v.string(),
    teamSize: v.string(),
    goals: v.array(v.string()),
    skipped: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<"personal" | "team"> => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not authenticated");
    const skipped = args.skipped ?? false;
    if (!skipped) {
      if (!(QUIZ_AUDIENCES as readonly string[]).includes(args.audience)) {
        throw new Error("Pick what best describes you");
      }
      if (!(QUIZ_TEAM_SIZES as readonly string[]).includes(args.teamSize)) {
        throw new Error("Pick how many people will use Creatily");
      }
    }
    const goals = args.goals.filter((g) => (QUIZ_GOALS as readonly string[]).includes(g));
    const recommended =
      args.audience === "agency" || args.teamSize === "small" || args.teamSize === "large"
        ? ("team" as const)
        : ("personal" as const);
    await ctx.db.patch(user._id, {
      planQuizPending: false,
      planQuiz: {
        audience: args.audience,
        teamSize: args.teamSize,
        goals,
        recommended,
        skipped,
        at: Date.now(),
      },
    });
    return recommended;
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
