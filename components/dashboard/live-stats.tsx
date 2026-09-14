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
        <Card key={card.label}>
          <CardContent className="flex items-center gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <card.icon className="size-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p className="text-xl font-semibold">
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
