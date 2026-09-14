"use client";

import Link from "next/link";
import { Coins } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { hasConvex } from "@/lib/runtime";

function Pill({ credits }: { credits: number | null }) {
  return (
    <Link
      href="/settings"
      className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
    >
      <Coins className="size-3.5" />
      {credits === null ? "—" : credits.toLocaleString()}
      <span className="hidden sm:inline">credits</span>
    </Link>
  );
}

function LiveCreditsPill() {
  const me = useQuery(api.users.me);
  return <Pill credits={me?.workspace?.credits ?? null} />;
}

export function CreditsPill() {
  if (!hasConvex) return <Pill credits={0} />;
  return <LiveCreditsPill />;
}
