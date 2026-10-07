import type { ActionCtx, QueryCtx } from "../_generated/server";
import { api } from "../_generated/api";
import { getCurrentUser, getPrimaryWorkspace } from "./auth";
import { planAtLeast, planNeededLabel, type Plan } from "../../lib/plan";

/**
 * Server-side plan enforcement. The sidebar lock and the page gate are UX;
 * these guards are the real wall — a free account calling a gated function
 * directly gets refused here. Admins bypass (they support every account).
 */

function refusal(feature: string, min: Plan): Error {
  return new Error(
    `UPGRADE_REQUIRED: ${feature} needs ${planNeededLabel(min)} — upgrade in Settings → Plan & Credits.`,
  );
}

/** For queries and mutations (ctx has db access). */
export async function assertPlanDb(
  ctx: QueryCtx,
  min: Plan,
  feature: string,
): Promise<void> {
  const user = await getCurrentUser(ctx);
  if (user?.adminRole) return;
  const workspace = user ? await getPrimaryWorkspace(ctx, user._id) : null;
  if (!planAtLeast(workspace?.plan, min)) throw refusal(feature, min);
}

/** For actions (goes through users.me). */
export async function assertPlanAction(
  ctx: ActionCtx,
  min: Plan,
  feature: string,
): Promise<void> {
  const me = await ctx.runQuery(api.users.me, {});
  if (me?.adminRole) return;
  if (!planAtLeast(me?.workspace?.plan, min)) throw refusal(feature, min);
}
