"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { hasConvex } from "@/lib/runtime";
import { ArrowUpRight, Coins, Inbox, MessageSquareReply, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Each stat opens the page where that number lives. */
const CARDS = [
  { key: "credits", label: "Credits", icon: Coins, href: "/settings?tab=billing" },
  { key: "activeCampaigns", label: "Active campaigns", icon: Send, href: "/outreach?tab=campaigns" },
  { key: "replies", label: "Replies", icon: MessageSquareReply, href: "/outreach?tab=master-inbox" },
  { key: "leads", label: "Leads saved", icon: Inbox, href: "/leads" },
] as const;

type Stats = { credits: number; activeCampaigns: number; replies: number; leads: number };

function StatsGrid({ stats }: { stats: Stats | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {CARDS.map((card) => {
        const value = stats?.[card.key];
        return (
          <Link key={card.key} href={card.href} className="group block" aria-label={`Open ${card.label}`}>
            <Card className="relative h-full overflow-hidden transition-all group-hover:-translate-y-0.5 group-hover:border-primary/50 group-hover:shadow-[0_18px_50px_-30px_rgba(234,197,79,0.45)]">
              <span
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full bg-gradient-to-br from-primary/25 to-transparent blur-2xl transition-opacity group-hover:opacity-100"
              />
              <CardContent className="relative flex items-center gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-primary/5 text-primary">
                  <card.icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                  <p className="text-2xl font-bold tracking-tight">
                    {value === undefined ? "—" : value.toLocaleString()}
                  </p>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:text-primary group-hover:opacity-100" />
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

function LiveStatsInner() {
  const stats = useQuery(api.dashboard.stats);
  return <StatsGrid stats={stats ?? null} />;
}

export function LiveStats() {
  if (!hasConvex) return <StatsGrid stats={null} />;
  return <LiveStatsInner />;
}
