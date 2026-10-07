/**
 * Plan gating — the single source of truth for what each plan unlocks.
 * Free = the Create with AI section only (everything still pays per use in
 * credits). Personal = every feature except Team. Team = everything.
 */

export type Plan = "free" | "personal" | "team";

export const PLAN_RANK: Record<Plan, number> = { free: 0, personal: 1, team: 2 };

export function planAtLeast(plan: string | null | undefined, min: Plan): boolean {
  const rank = PLAN_RANK[(plan ?? "free") as Plan] ?? 0;
  return rank >= PLAN_RANK[min];
}

/** Routes locked behind a plan — anything not listed here is free. */
export const GATED_ROUTES = {
  "/outreach": { minPlan: "personal", feature: "Outreach" },
  "/leads": { minPlan: "personal", feature: "Scrape Leads" },
  "/receptionist": { minPlan: "personal", feature: "AI Receptionist" },
  "/qualifier": { minPlan: "personal", feature: "AI Cold Calling" },
  "/voices": { minPlan: "personal", feature: "Clone Your Voice" },
  "/ig-dms": { minPlan: "personal", feature: "IG DMs & AI Voice" },
  "/note-taker": { minPlan: "personal", feature: "AI Note Taker" },
  "/team": { minPlan: "team", feature: "Team" },
} as const satisfies Record<string, { minPlan: Plan; feature: string }>;

export type GatedRoute = keyof typeof GATED_ROUTES;

/** "the Personal or Team plan" / "the Team plan" — for lock copy. */
export function planNeededLabel(min: Plan): string {
  return min === "team" ? "the Team plan" : "the Personal or Team plan";
}
