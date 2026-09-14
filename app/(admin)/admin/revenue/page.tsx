"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { DollarSign, Gift, Receipt, TrendingUp } from "lucide-react";
import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

const KIND_LABELS: Record<string, string> = {
  subscription: "Subscriptions",
  topup: "Credit top-ups",
  phone_number: "Phone numbers",
  domain: "Domains",
  prewarmed_inbox: "Prewarmed inboxes",
};

function usd(n: number | undefined): string {
  return n === undefined ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function RevenueView() {
  const revenue = useQuery(api.admin.revenue);
  const cards = [
    { label: "Total revenue", value: usd(revenue?.total), icon: DollarSign },
    { label: "Paid purchases", value: revenue?.purchaseCount ?? "—", icon: Receipt },
    { label: "Referral payouts owed", value: usd(revenue?.payoutsOwed), icon: Gift },
    { label: "Referral payouts paid", value: usd(revenue?.payoutsPaid), icon: TrendingUp },
  ];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="flex items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <c.icon className="size-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-xl font-semibold">{String(c.value)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-widest text-muted-foreground">
        By source
      </h2>
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {Object.entries(KIND_LABELS).map(([kind, label]) => (
            <div key={kind} className="flex items-center justify-between px-5 py-3.5">
              <p className="text-sm">{label}</p>
              <p className="font-mono text-sm text-primary">
                {usd(revenue?.byKind?.[kind] ?? 0)}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

export default function AdminRevenuePage() {
  return (
    <LivePage>
      <PageHeader
        title="Revenue"
        description="Money generated across the platform. Superadmin only."
      />
      <RevenueView />
    </LivePage>
  );
}
