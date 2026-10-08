"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { DollarSign, Gift, Loader2, Receipt, TrendingUp } from "lucide-react";
import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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

      <ReferralPayouts />
    </>
  );
}

/**
 * Who is owed referral commission right now. "Mark paid" records that the
 * transfer was made outside the app (bank, PayPal, Whop payout) and notifies
 * the referrer; it never moves money itself.
 */
function ReferralPayouts() {
  const rows = useQuery(api.admin.referralPayouts);
  const markPaid = useMutation(api.admin.markReferralPayoutsPaid);
  const [busy, setBusy] = useState<string | null>(null);

  const pay = async (userId: Id<"users">, email: string, owedUsd: number) => {
    if (!window.confirm(`Mark $${owedUsd.toFixed(2)} as paid to ${email}? Do this after the transfer has actually been sent.`)) return;
    setBusy(userId);
    try {
      const result = await markPaid({ referrerUserId: userId });
      toast.success(`Recorded $${result.total.toFixed(2)} paid to ${email} (${result.count} item${result.count === 1 ? "" : "s"}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message.split("Uncaught Error: ").pop() : "Couldn't mark as paid.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-widest text-muted-foreground">
        Referral payouts
      </h2>
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {rows === undefined ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : rows === null || rows.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No referral commissions yet. Each referred payment adds 15% here for the referrer.
            </p>
          ) : (
            rows.map((r) => (
              <div key={r.userId} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name ? `${r.name} · ` : ""}{r.email}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {r.activeReferrals} paying referral{r.activeReferrals === 1 ? "" : "s"}
                    {" · "}{r.owedCount} item{r.owedCount === 1 ? "" : "s"} owed
                    {r.lastOwedAt ? ` · latest ${new Date(r.lastOwedAt).toLocaleDateString()}` : ""}
                    {" · "}paid so far {usd(r.paidUsd)}
                  </p>
                </div>
                <p className="font-mono text-sm tabular-nums text-primary">{usd(r.owedUsd)}</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={r.owedUsd <= 0 || busy === r.userId}
                  onClick={() => pay(r.userId, r.email, r.owedUsd)}
                >
                  {busy === r.userId ? <Loader2 className="size-4 animate-spin" /> : null}
                  Mark paid
                </Button>
              </div>
            ))
          )}
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
