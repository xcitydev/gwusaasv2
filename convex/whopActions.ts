import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import {
  whopPlansConfigured,
  whopTopupsConfigured,
  createPlanCheckout,
  createTopupCheckout,
} from "./lib/whop";

/**
 * Checkout creation — the only place the Clerk identity and the Whop
 * purchase ever meet. The signed-in user's workspaceId/userId are stamped
 * into the checkout metadata here; webhooks map money back with them.
 */

const NOT_CONFIGURED =
  "NOT_CONFIGURED: Payments aren't switched on yet (Whop keys pending).";

function redirectUrl(): string | undefined {
  const app = process.env.APP_URL;
  return app ? `${app.replace(/\/$/, "")}/settings?purchase=success` : undefined;
}

export const startPlanCheckout = action({
  args: { plan: v.union(v.literal("personal"), v.literal("team")) },
  handler: async (ctx, args): Promise<{ url: string }> => {
    if (!whopPlansConfigured()) throw new Error(NOT_CONFIGURED);
    const me = await ctx.runQuery(api.users.me, {});
    if (!me?.workspace) throw new Error("Not signed in");
    if (!me.workspace.isOwner) {
      throw new Error(
        "Only the workspace owner can change the plan — ask them to upgrade.",
      );
    }
    const planId =
      args.plan === "team"
        ? process.env.WHOP_PLAN_TEAM!
        : process.env.WHOP_PLAN_PERSONAL!;
    const { url } = await createPlanCheckout({
      planId,
      metadata: {
        workspaceId: me.workspace._id,
        userId: me._id,
        kind: "plan",
        plan: args.plan,
      },
      redirectUrl: redirectUrl(),
    });
    return { url };
  },
});

export const startTopupCheckout = action({
  args: { credits: v.number() },
  handler: async (ctx, args): Promise<{ url: string; usd: number }> => {
    if (!whopTopupsConfigured()) throw new Error(NOT_CONFIGURED);
    const me = await ctx.runQuery(api.users.me, {});
    if (!me?.workspace) throw new Error("Not signed in");
    const quote: { credits: number; usd: number } = await ctx.runQuery(
      internal.whop.topupQuote,
      { credits: args.credits },
    );
    const { url } = await createTopupCheckout({
      usd: quote.usd,
      title: `${quote.credits.toLocaleString()} credits`,
      metadata: {
        workspaceId: me.workspace._id,
        userId: me._id,
        kind: "topup",
        credits: String(quote.credits),
      },
      redirectUrl: redirectUrl(),
    });
    return { url, usd: quote.usd };
  },
});
