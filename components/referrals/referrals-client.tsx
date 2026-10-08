"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Copy, DollarSign, Repeat, UserCheck, Users } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const usd = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ReferralsClient() {
  const data = useQuery(api.referrals.mine);
  const percent = data?.percent ?? 15;
  const link =
    typeof window !== "undefined" && data
      ? `${window.location.origin}/sign-up?ref=${data.referralCode}`
      : "";

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Referral link copied — share it anywhere.");
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  };

  const stats = [
    { label: "Signups", value: data?.totalSignups ?? 0, icon: Users },
    { label: "Paying now", value: data?.active ?? 0, icon: UserCheck },
    { label: "Per renewal cycle", value: usd(data?.monthlyUsd ?? 0), icon: Repeat },
    { label: "Earned, lifetime", value: usd(data?.earnedUsd ?? 0), icon: DollarSign },
  ];

  return (
    <div>
      <Card className="border-primary/20">
        <CardContent className="py-8">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              Earn {percent}% of every payment, for life
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Share your link. When someone subscribes, {percent}% of their first
              charge and of every renewal is yours, for as long as they stay.
            </p>
            <div className="mt-5 flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs" />
              <Button onClick={copy} disabled={!link} data-tour="referrals-copy">
                <Copy className="size-4" /> Copy
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Owed to you: {usd(data?.owedUsd ?? 0)} · Paid out: {usd(data?.paidUsd ?? 0)}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-4">
              <stat.icon className="size-5 shrink-0 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-semibold tabular-nums">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Your referrals</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!data || data.referrals.length === 0 ? (
            <p className="px-5 pb-8 pt-2 text-center text-sm text-muted-foreground">
              No referrals yet — share your link to start earning.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {data.referrals.map((referral) => (
                <div key={referral._id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{referral.referredEmail}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      Joined {new Date(referral._creationTime).toLocaleDateString()}
                      {referral.plan && ` · ${referral.plan} plan`}
                      {referral.paymentCount > 0 &&
                        ` · ${referral.paymentCount} payment${referral.paymentCount === 1 ? "" : "s"} · ${usd(referral.lifetimeUsd)} earned`}
                      {referral.commissionPercent != null && ` · ${referral.commissionPercent}% locked`}
                    </p>
                  </div>
                  <StatusBadge status={referral.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.commissions.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Recent commissions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {data.commissions.map((c) => (
                <div key={c._id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {c.kind === "first" ? "First payment" : "Renewal"} · {c.referredEmail}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {new Date(c._creationTime).toLocaleDateString()} · {c.plan} plan · {usd(c.paymentUsd)} × {c.percent}%
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums">{usd(c.amountUsd)}</span>
                    <StatusBadge status={c.status} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
