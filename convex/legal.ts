import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireUser } from "./lib/auth";
import { TERMS_VERSION } from "../lib/legal";

/**
 * Clickwrap record. Sign-up shows "By creating an account you agree…";
 * the app shell then records acceptance server-side (and re-asks anyone who
 * accepted an older TERMS_VERSION, or signed up before this existed).
 */

/** Does the signed-in user still need to accept the current Terms? */
export const termsStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      currentVersion: TERMS_VERSION,
      acceptedVersion: user.termsVersion ?? null,
      acceptedAt: user.termsAcceptedAt ?? null,
      // Lets the client auto-record a just-completed sign-up clickwrap.
      accountCreatedAt: user._creationTime,
      needsAcceptance: user.termsVersion !== TERMS_VERSION,
    };
  },
});

export const acceptTerms = mutation({
  args: { version: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    // A stale tab can't record acceptance of a version it never showed.
    if (args.version !== TERMS_VERSION) {
      throw new Error("The Terms were just updated — reload the page to review them.");
    }
    if (user.termsVersion === TERMS_VERSION) return;
    await ctx.db.patch(user._id, { termsAcceptedAt: Date.now(), termsVersion: TERMS_VERSION });
  },
});
