import Link from "next/link";
import { ArrowRight, Check, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { planNeededLabel, type Plan } from "@/lib/plan";

const PERSONAL_UNLOCKS = [
  "Outreach — cold email campaigns & unified replies",
  "Scrape Leads — Google Maps, LinkedIn and B2B databases",
  "AI Receptionist & AI Cold Calling — in your cloned voice",
  "IG DMs & AI Voice",
  "AI Note Taker for Zoom, Meet and Teams",
  "10,000 credits every month",
];

const TEAM_UNLOCKS = [
  "Everything in Personal",
  "Team members in one shared workspace",
  "Shared leads, inboxes, campaigns and credits",
  "30,000 credits every month",
];

/**
 * Rendered server-side in place of a gated page when the workspace's plan
 * doesn't cover it. The Convex functions behind the feature refuse free
 * callers too — this screen is the friendly half of that wall.
 */
export function UpgradeGate({
  feature,
  minPlan,
}: {
  feature: string;
  minPlan: Plan;
}) {
  const unlocks = minPlan === "team" ? TEAM_UNLOCKS : PERSONAL_UNLOCKS;
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-primary/25 bg-card p-8 text-center sm:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(420px 260px at 50% -10%, oklch(0.598 0.241 294.3 / 0.12), transparent 70%)",
          }}
        />
        <div className="relative">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Lock className="size-6" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            {feature} needs {planNeededLabel(minPlan)}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {minPlan === "team"
              ? "Bring your team into one shared workspace — same leads, inboxes, campaigns and credit pool."
              : "Your free plan includes Create with AI. Upgrade to put the whole growth team to work."}
          </p>
          <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm">
            {unlocks.map((u) => (
              <li key={u} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{u}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="rounded-full px-6">
              <Link href="/settings">
                Upgrade now <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-6">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
