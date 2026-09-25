"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { hasConvex } from "@/lib/runtime";
import { Coins, Inbox, MessageSquareReply, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

function StatsGrid({
  stats,
}: {
  stats: { credits: number; activeCampaigns: number; replies: number; leads: number } | null;
}) {
  const cards = [
    { label: "Credits", value: stats?.credits, icon: Coins },
    { label: "Active campaigns", value: stats?.activeCampaigns, icon: Send },
    { label: "Replies", value: stats?.replies, icon: MessageSquareReply },
    { label: "Leads saved", value: stats?.leads, icon: Inbox },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="relative overflow-hidden">
          <span
            aria-hidden
            className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full bg-gradient-to-br from-primary/25 to-transparent blur-2xl"
          />
          <CardContent className="relative flex items-center gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-primary/5 text-primary">
              <card.icon className="size-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p className="text-2xl font-bold tracking-tight">
                {card.value === undefined ? "—" : card.value.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
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
