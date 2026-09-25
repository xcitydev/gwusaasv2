"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ListSkeleton } from "@/components/list-skeleton";
import { InviteCodeCard } from "@/components/forms/forms-gate";
import { PricingTable, UserProfile } from "@clerk/nextjs";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  CreditCard,
  UserRound,
} from "lucide-react";
import { isConfigured } from "@/lib/runtime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    id: "free",
    label: "Free",
    blurb: "Explore the platform. Onboarding forms unlock with an invite code.",
    features: ["Onboarding forms (with an invite code)", "Support tickets"],
  },
  {
    id: "personal",
    label: "Personal",
    blurb: "The whole platform, for one person.",
    features: [
      "Everything in Free",
      "Cold email engine",
      "Find Leads + AI search",
      "Create with AI & AI tools",
      "AI receptionist & qualifier",
      "10,000 credits included",
      "50% referral earnings",
    ],
  },
  {
    id: "team",
    label: "Team / Agency",
    blurb: "Everything, for your whole team.",
    features: [
      "Everything in Personal",
      "Add team members",
      "Shared leads & campaigns",
      "30,000 credits included (3×)",
    ],
  },
];

function AccountTab() {
  if (!isConfigured) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <UserRound className="size-8 text-muted-foreground" />
          <p className="font-medium">Account management</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Profile, email and security settings appear here once Clerk keys are
            added.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <InviteCodeCard />
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <UserProfile
        routing="hash"
        appearance={{
          // Match the platform's gold/black theme so nothing reads as
          // stock Clerk. Hex values mirror the oklch tokens in globals.css.
          options: { unsafe_disableDevelopmentModeWarnings: true },
          variables: {
            colorPrimary: "#eac54f",
            colorPrimaryForeground: "#1d1a10",
            colorBackground: "#1a1917",
            colorForeground: "#f7f7f7",
            colorMutedForeground: "#a3a19c",
            colorMuted: "#242320",
            colorInput: "#131211",
            colorInputForeground: "#f7f7f7",
            colorBorder: "#33322e",
            colorNeutral: "#f7f7f7",
            colorDanger: "#e05d44",
            colorSuccess: "#4fbf7c",
            borderRadius: "0.65rem",
            fontFamily: "var(--font-geist-sans), sans-serif",
          },
          elements: {
            rootBox: "w-full",
            cardBox: "w-full !shadow-none !border-0 !bg-transparent",
            card: "!bg-transparent",
            scrollBox: "!bg-transparent",
            pageScrollBox: "!bg-transparent",
            navbar: "!bg-transparent !border-r !border-border [background:none]",
            navbarButton: "!text-foreground/80 hover:!bg-secondary/60",
            navbarButtonIcon: "!text-primary",
            headerTitle: "!text-foreground",
            profileSectionTitleText: "!text-foreground",
            // Kill the Clerk branding footer + badge.
            footer: "!hidden",
            footerItem: "!hidden",
            badge: "!hidden",
            logoBox: "!hidden",
          },
        }}
      />
      </div>
    </div>
  );
}

/** Fallback plan display before Clerk Billing is configured. */
function StaticPlanCards({ currentPlan }: { currentPlan: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {PLANS.map((plan) => {
        const isCurrent = plan.id === currentPlan;
        return (
          <Card
            key={plan.id}
            className={cn(isCurrent && "border-primary/50 bg-primary/5")}
          >
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                {plan.label}
                {isCurrent && (
                  <Badge className="bg-primary text-primary-foreground">Current</Badge>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{plan.blurb}</p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
              {!isCurrent && plan.id !== "free" && (
                <Button
                  className="mt-4 w-full"
                  variant={plan.id === "team" ? "default" : "outline"}
                  onClick={() =>
                    toast.info("Upgrades activate once billing keys are added.")
                  }
                >
                  <CreditCard className="size-4" /> Upgrade
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/** Windowed page list: 1 … 4 5 6 … 12 (0-based pages in, "…" gaps out). */
function pageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const around = [current - 1, current, current + 1].filter(
    (p) => p > 0 && p < total - 1,
  );
  const out: (number | "…")[] = [0];
  if ((around[0] ?? total) > 1) out.push("…");
  out.push(...around);
  if ((around[around.length - 1] ?? -1) < total - 2) out.push("…");
  out.push(total - 1);
  return out;
}

function BillingTab() {
  const me = useQuery(api.users.me);
  // Server-side pages of 10 — only the visible page ships to the browser.
  const [ledgerPage, setLedgerPage] = useState(0);
  const ledgerQuery = useQuery(api.billing.ledger, { page: ledgerPage });
  // Keep the previous page on screen while the next one loads (no flicker) —
  // the store-latest-during-render pattern from the React docs.
  const [ledgerData, setLedgerData] = useState(ledgerQuery);
  if (ledgerQuery !== undefined && ledgerQuery !== ledgerData) {
    setLedgerData(ledgerQuery);
  }
  const ledger = ledgerData?.rows ?? [];
  const totalPages = Math.max(
    1,
    Math.ceil((ledgerData?.total ?? 0) / (ledgerData?.pageSize ?? 10)),
  );
  const topUp = useMutation(api.billing.topUp);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [amount, setAmount] = useState("5000");

  const currentPlan = me?.workspace?.plan ?? "free";

  const doTopUp = async () => {
    try {
      await topUp({ credits: Number(amount) || 0 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(
        msg.includes("NOT_CONFIGURED")
          ? "Top-ups activate once billing keys are added — contact support meanwhile."
          : "Top-up failed.",
      );
    }
    setTopUpOpen(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="size-4 text-primary" /> Credits
          </CardTitle>
          <Button size="sm" onClick={() => setTopUpOpen(true)}>Top up</Button>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold text-primary">
            {(me?.workspace?.credits ?? 0).toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Credits power AI generation, lead imports, and per-second voice billing.
          </p>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Plans
        </h2>
        {isConfigured ? (
          // Clerk Billing's live checkout — plans come from the Clerk dashboard.
          <PricingTable />
        ) : (
          <StaticPlanCards currentPlan={currentPlan} />
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Credit history</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {ledgerData === undefined ? (
            <ListSkeleton rows={4} inCard={false} />
          ) : ledger.length === 0 ? (
            <p className="px-5 pb-8 pt-2 text-center text-sm text-muted-foreground">
              Credit activity appears here — grants, spends and refunds.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((entry) => (
                  <TableRow key={entry._id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(entry._creationTime).toLocaleString()}
                    </TableCell>
                    <TableCell>{entry.description}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono",
                        entry.amount > 0 ? "text-emerald-400" : "text-destructive",
                      )}
                    >
                      {entry.amount > 0 ? "+" : ""}
                      {entry.amount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {entry.balanceAfter.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 border-t border-border p-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={ledgerPage === 0}
                onClick={() => setLedgerPage((p) => Math.max(0, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              {pageNumbers(ledgerPage, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`gap-${i}`} className="px-1 text-sm text-muted-foreground">
                    …
                  </span>
                ) : (
                  <Button
                    key={p}
                    variant={p === ledgerPage ? "default" : "ghost"}
                    size="icon"
                    className="size-8 text-sm"
                    onClick={() => setLedgerPage(p)}
                  >
                    {p + 1}
                  </Button>
                ),
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={ledgerPage >= totalPages - 1}
                onClick={() => setLedgerPage((p) => Math.min(totalPages - 1, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Top up credits</DialogTitle>
            <DialogDescription>
              Buy additional credits at the current per-credit price.
            </DialogDescription>
          </DialogHeader>
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="5000"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopUpOpen(false)}>Cancel</Button>
            <Button onClick={doTopUp}>Continue to payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SettingsClient() {
  return (
    <Tabs defaultValue="billing">
      <TabsList className="mb-4">
        <TabsTrigger value="billing" className="gap-1.5">
          <CreditCard className="size-4" /> Plan & Credits
        </TabsTrigger>
        <TabsTrigger value="account" className="gap-1.5">
          <UserRound className="size-4" /> Account
        </TabsTrigger>
      </TabsList>
      <TabsContent value="billing"><BillingTab /></TabsContent>
      <TabsContent value="account"><AccountTab /></TabsContent>
    </Tabs>
  );
}
