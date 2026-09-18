"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Copy, DollarSign, Gift, UserPlus, Users } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function ReferralsClient() {
  const data = useQuery(api.referrals.mine);
  const link =
    typeof window !== "undefined" && data
      ? `${window.location.origin}/sign-up?ref=${data.referralCode}`
      : "";

  const copy = () => {
    navigator.clipboard.writeText(link);
    toast.success("Referral link copied — share it anywhere.");
  };

  const stats = [
    { label: "Signups", value: data?.totalSignups ?? 0, icon: Users },
    { label: "Qualified", value: data?.qualified ?? 0, icon: UserPlus },
    { label: "Earned", value: `$${(data?.earnedUsd ?? 0).toLocaleString()}`, icon: DollarSign },
    { label: "Paid out", value: `$${(data?.paidUsd ?? 0).toLocaleString()}`, icon: Gift },
  ];

  return (
    <div>
      <Card className="border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
        <CardContent className="py-8">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="font-display text-2xl italic">
              Earn {data?.percent ?? 50}% for every referral
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Share your link. When someone subscribes to a paid plan, you get a
              {" "}{data?.percent ?? 50}% commission.
            </p>
            <div className="mt-5 flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs" />
              <Button onClick={copy}>
                <Copy className="size-4" /> Copy
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <stat.icon className="size-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-semibold">{stat.value}</p>
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
                    <p className="text-xs text-muted-foreground">
                      {new Date(referral._creationTime).toLocaleDateString()}
                      {referral.plan && ` · ${referral.plan} plan`}
                      {referral.payoutUsd != null && ` · $${referral.payoutUsd}`}
                    </p>
                  </div>
                  <StatusBadge status={referral.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
