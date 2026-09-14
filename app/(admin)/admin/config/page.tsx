"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const CONFIG_META: {
  key: string;
  label: string;
  help: string;
  kind: "number" | "email";
}[] = [
  {
    key: "creditPriceUsd",
    label: "Price per credit (USD)",
    help: "What one credit costs users when topping up.",
    kind: "number",
  },
  {
    key: "personalPlanCredits",
    label: "Personal plan credits",
    help: "Credits granted on the Personal plan.",
    kind: "number",
  },
  {
    key: "teamPlanCredits",
    label: "Team plan credits",
    help: "Credits granted on the Team/Agency plan.",
    kind: "number",
  },
  {
    key: "generationMarkup",
    label: "Generation markup (×)",
    help: "Provider cost is multiplied by this for Create with AI pricing.",
    kind: "number",
  },
  {
    key: "referralPercent",
    label: "Referral percentage (%)",
    help: "One-time commission for referring a paid subscription.",
    kind: "number",
  },
  {
    key: "voiceCreditsPerSecond",
    label: "Voice credits per second",
    help: "Receptionist and qualifier call billing rate.",
    kind: "number",
  },
  {
    key: "leadCreditCostMaps",
    label: "Credits per Google Maps lead",
    help: "Charged when importing local-business leads.",
    kind: "number",
  },
  {
    key: "leadCreditCostB2B",
    label: "Credits per B2B/LinkedIn lead",
    help: "Charged for verified database and LinkedIn contacts.",
    kind: "number",
  },
  {
    key: "leadCreditCostNiche",
    label: "Credits per niche-scraper lead",
    help: "Realtor.com and other niche sources.",
    kind: "number",
  },
  {
    key: "personalPlanPriceUsd",
    label: "Personal plan price (USD/mo)",
    help: "Used for referral payout math.",
    kind: "number",
  },
  {
    key: "teamPlanPriceUsd",
    label: "Team plan price (USD/mo)",
    help: "Used for referral payout math.",
    kind: "number",
  },
  {
    key: "adminNotificationEmail",
    label: "Admin notification email",
    help: "Receives form-submission and ticket notifications.",
    kind: "email",
  },
  {
    key: "teamNotificationEmail",
    label: "Team notification email",
    help: "Second recipient for form-submission notifications.",
    kind: "email",
  },
];

function ConfigEditor() {
  const config = useQuery(api.config.getAll);
  const set = useMutation(api.config.set);
  const [editing, setEditing] = useState<(typeof CONFIG_META)[number] | null>(null);
  const [value, setValue] = useState("");

  const save = async () => {
    if (!editing) return;
    const parsed = editing.kind === "number" ? Number(value) : value.trim();
    if (editing.kind === "number" && (!Number.isFinite(parsed) || Number(parsed) < 0)) {
      toast.error("Enter a valid non-negative number.");
      return;
    }
    try {
      await set({ key: editing.key, value: parsed });
      toast.success(`${editing.label} updated.`);
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed — superadmin only.");
    }
  };

  return (
    <>
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {CONFIG_META.map((meta) => {
            const current = config?.[meta.key as keyof typeof config];
            return (
              <div
                key={meta.key}
                className="flex items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{meta.label}</p>
                  <p className="text-xs text-muted-foreground">{meta.help}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-sm text-primary">
                    {current === "" || current === undefined
                      ? "—"
                      : String(current)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${meta.label}`}
                    onClick={() => {
                      setEditing(meta);
                      setValue(current === undefined ? "" : String(current));
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.label}</DialogTitle>
            <DialogDescription>{editing?.help}</DialogDescription>
          </DialogHeader>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode={editing?.kind === "number" ? "decimal" : undefined}
            type={editing?.kind === "email" ? "email" : "text"}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminConfigPage() {
  return (
    <LivePage>
      <PageHeader
        title="Platform Config"
        description="Superadmin-controlled pricing and platform settings."
      />
      <ConfigEditor />
    </LivePage>
  );
}
