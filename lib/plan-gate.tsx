import "server-only";
import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { isConfigured } from "@/lib/runtime";
import { GATED_ROUTES, planAtLeast, type GatedRoute } from "@/lib/plan";
import { UpgradeGate } from "@/components/upgrade-gate";

/**
 * Server-side page gate. Call at the top of a gated page:
 *
 *   const gate = await planGate("/outreach");
 *   if (gate) return gate;
 *
 * The plan is read from Convex on the server, so a free account never
 * receives the feature's markup at all — it gets the upgrade screen.
 * (The feature's Convex functions refuse free callers independently.)
 */
export async function planGate(route: GatedRoute): Promise<ReactNode | null> {
  if (!isConfigured) return null; // Setup mode: everything previewable.
  const { minPlan, feature } = GATED_ROUTES[route];
  const { userId, getToken } = await auth();
  if (!userId) return null; // proxy.ts already redirects signed-out visitors.
  const token = await getToken({ template: "convex" });
  const me = token ? await fetchQuery(api.users.me, {}, { token }) : null;
  if (me?.adminRole) return null; // Admins support every account.
  if (planAtLeast(me?.workspace?.plan, minPlan)) return null;
  return <UpgradeGate feature={feature} minPlan={minPlan} />;
}
