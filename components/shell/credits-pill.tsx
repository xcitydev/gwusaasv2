"use client";

import Link from "next/link";
import { Coins } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { hasConvex } from "@/lib/runtime";
import { openTopUp } from "@/lib/top-up-prompt";
import { cn } from "@/lib/utils";

/** Below this share of the plan's monthly credits the pill turns amber and offers a top-up. */
const LOW_SHARE = 0.1;
const PLAN_MONTHLY: Record<string, number> = { free: 2_000, personal: 10_000, team: 30_000 };

function Pill({
  credits,
  low,
  onTopUp,
}: {
  credits: number | null;
  low: boolean;
  onTopUp?: () => void;
}) {
  const className = cn(
    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    low
      ? "border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
      : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20",
  );
  const label = (
    <>
      <Coins className="size-3.5" />
      {credits === null ? "—" : credits.toLocaleString()}
      <span className="hidden sm:inline">{low ? "credits · top up" : "credits"}</span>
    </>
  );
  // Low balance: the pill itself opens the top-up dialog. Otherwise it links to Settings.
  if (low && onTopUp) {
    return (
      <button type="button" onClick={onTopUp} className={className} aria-label="Credits are low, top up">
        {label}
      </button>
    );
  }
  return (
    <Link href="/settings?tab=billing" className={className}>
      {label}
    </Link>
  );
}

function LiveCreditsPill() {
  const me = useQuery(api.users.me);
  const credits = me?.workspace?.credits ?? null;
  const plan = me?.workspace?.plan ?? "free";
  const low = credits !== null && credits < (PLAN_MONTHLY[plan] ?? 10_000) * LOW_SHARE;
  return (
    <Pill
      credits={credits}
      low={low}
      onTopUp={() => openTopUp({ have: credits ?? undefined, context: "Your balance is running low." })}
    />
  );
}

export function CreditsPill() {
  if (!hasConvex) return <Pill credits={0} low={false} />;
  return <LiveCreditsPill />;
}
