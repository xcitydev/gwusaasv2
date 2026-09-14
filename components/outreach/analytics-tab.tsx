"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Mail, MessageSquareReply, ThumbsUp, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Palette validated for the dark surface with the dataviz six-checks script:
// gold #b48d05 (sent) and blue #0284c7 (replies) — CVD-safe pair.
const SERIES = { sent: "#b48d05", replied: "#0284c7" } as const;

export function AnalyticsTab() {
  const analytics = useQuery(api.outreach.analytics);

  const cards = [
    { label: "Emails sent", value: analytics?.totals.sent ?? 0, icon: Mail },
    { label: "Unique leads contacted", value: analytics?.uniqueLeadsContacted ?? 0, icon: Users },
    { label: "Replies", value: analytics?.totals.replied ?? 0, icon: MessageSquareReply },
    { label: "Positive replies", value: analytics?.positiveReplies ?? 0, icon: ThumbsUp },
  ];

  const chartData =
    analytics?.campaigns.map((c) => ({
      name: c.name.length > 18 ? c.name.slice(0, 17) + "…" : c.name,
      Sent: c.stats.sent,
      Replies: c.stats.replied,
    })) ?? [];

  const hasData = chartData.some((d) => d.Sent > 0 || d.Replies > 0);

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent className="flex items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <card.icon className="size-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="text-xl font-semibold">{card.value.toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Sent vs replies by campaign</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <BarChart3 className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Stats appear here once campaigns start sending.
              </p>
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barGap={2}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--accent)" }}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      color: "var(--foreground)",
                    }}
                  />
                  <Legend
                    wrapperStyle={{ color: "var(--muted-foreground)", fontSize: 12 }}
                  />
                  <Bar dataKey="Sent" fill={SERIES.sent} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="Replies" fill={SERIES.replied} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
