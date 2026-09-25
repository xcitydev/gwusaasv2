"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CsvImportButton } from "@/components/leads/csv-import-button";
import { SequenceEditor } from "@/components/outreach/sequence-editor";
import { CAMPAIGN_TIMEZONES, DEFAULT_CAMPAIGN_TIMEZONE } from "@/lib/timezones";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

type Step = { waitDays: number; subject: string; variants: string[] };

const WIZARD_STEPS = ["Details", "Leads", "Sequence", "Schedule", "Inboxes", "Review"];

export function CampaignWizard({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: Id<"campaigns">) => void;
}) {
  const leads = useQuery(api.leads.list) ?? [];
  const inboxes = useQuery(api.outreach.listInboxes) ?? [];
  const createCampaign = useMutation(api.outreach.createCampaign);

  const [stepIdx, setStepIdx] = useState(0);
  const [name, setName] = useState("");
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [sequence, setSequence] = useState<Step[]>([
    { waitDays: 0, subject: "", variants: [""] },
  ]);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("17:00");
  const [timezone, setTimezone] = useState(DEFAULT_CAMPAIGN_TIMEZONE);
  const [dailyCap, setDailyCap] = useState("50");
  const [selectedInboxes, setSelectedInboxes] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);

  // Preview against selected leads (all leads as fallback).
  const previewPool = leads.filter((l) => selectedLeads.has(l._id));
  const previewChoices = previewPool.length > 0 ? previewPool : leads;

  const validateStep = (): string | null => {
    switch (stepIdx) {
      case 0:
        return name.trim() ? null : "Name your campaign first.";
      case 1:
        return selectedLeads.size > 0 ? null : "Select at least one lead.";
      case 2:
        return sequence.every((s) => s.subject.trim() && s.variants[0]?.trim())
          ? null
          : "Every step needs a subject and a script.";
      case 3:
        return Number(dailyCap) >= 1 ? null : "Set a daily cap of at least 1.";
      case 4:
        return selectedInboxes.size > 0 ? null : "Pick at least one inbox.";
      default:
        return null;
    }
  };

  const next = () => {
    const error = validateStep();
    if (error) {
      toast.error(error);
      return;
    }
    setStepIdx((i) => Math.min(i + 1, WIZARD_STEPS.length - 1));
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const id = await createCampaign({
        name,
        steps: sequence,
        sendWindowStart: windowStart,
        sendWindowEnd: windowEnd,
        timezone,
        dailyCap: Number(dailyCap),
        inboxIds: [...selectedInboxes] as Id<"inboxes">[],
        leadIds: [...selectedLeads] as Id<"leads">[],
      });
      toast.success("Campaign created as a draft — activate it when ready.");
      onCreated?.(id);
      onOpenChange(false);
      // Reset for next time
      setStepIdx(0);
      setName("");
      setSelectedLeads(new Set());
      setSequence([{ waitDays: 0, subject: "", variants: [""] }]);
      setSelectedInboxes(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the campaign.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription className="sr-only">Campaign setup wizard</DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex flex-wrap items-center gap-1.5">
          {WIZARD_STEPS.map((label, i) => (
            <button
              key={label}
              onClick={() => i < stepIdx && setStepIdx(i)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                i === stepIdx
                  ? "bg-primary text-primary-foreground"
                  : i < stepIdx
                    ? "bg-primary/15 text-primary"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>

        <ScrollArea className="min-h-0 flex-1 pr-3">
          <div className="space-y-4 py-2">
            {stepIdx === 0 && (
              <div>
                <Label className="mb-1.5">Campaign name *</Label>
                <Input
                  placeholder="Q1 Realtors — New York"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Only you and your team see this name.
                </p>
              </div>
            )}

            {stepIdx === 1 && (
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <Label>Pick leads ({selectedLeads.size} selected)</Label>
                  <div className="flex items-center gap-2">
                    <CsvImportButton
                      sourceDetail={name.trim() ? `Campaign: ${name.trim()}` : "Campaign CSV"}
                      onImported={(ids) =>
                        setSelectedLeads((prev) => new Set([...prev, ...ids]))
                      }
                    />
                    {leads.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSelectedLeads(
                            selectedLeads.size === leads.length
                              ? new Set()
                              : new Set(leads.map((l) => l._id)),
                          )
                        }
                      >
                        {selectedLeads.size === leads.length ? "Deselect all" : "Select all"}
                      </Button>
                    )}
                  </div>
                </div>
                {leads.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    <p>
                      No leads yet — import a CSV right here (it lands in your
                      lead store too), or find them in Find Leads.
                    </p>
                    <CsvImportButton
                      variant="default"
                      size="default"
                      sourceDetail={name.trim() ? `Campaign: ${name.trim()}` : "Campaign CSV"}
                      onImported={(ids) =>
                        setSelectedLeads((prev) => new Set([...prev, ...ids]))
                      }
                    />
                    <p className="text-xs">
                      Needs an <code className="text-primary">email</code> column ·
                      optional: name, company, title, phone, location, industry, website
                    </p>
                  </div>
                ) : (
                  <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border">
                    {leads.map((lead) => (
                      <label
                        key={lead._id}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
                      >
                        <Checkbox
                          checked={selectedLeads.has(lead._id)}
                          onCheckedChange={(checked) => {
                            const nextSet = new Set(selectedLeads);
                            if (checked) nextSet.add(lead._id);
                            else nextSet.delete(lead._id);
                            setSelectedLeads(nextSet);
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {lead.name ?? lead.email}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {lead.company ?? lead.email}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {stepIdx === 2 && (
              <SequenceEditor
                steps={sequence}
                onChange={setSequence}
                previewLeads={previewChoices}
              />
            )}

            {stepIdx === 3 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5">Send from</Label>
                  <Input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1.5">Until</Label>
                  <Input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1.5">Timezone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CAMPAIGN_TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5">Max emails per day</Label>
                  <Input inputMode="numeric" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} />
                </div>
              </div>
            )}

            {stepIdx === 4 && (
              <div>
                <Label className="mb-2">
                  Send from ({selectedInboxes.size} selected)
                </Label>
                {inboxes.length === 0 ? (
                  <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    No inboxes yet — connect one in the Inboxes tab first.
                  </p>
                ) : (
                  <div className="divide-y divide-border rounded-lg border">
                    {inboxes.map((inbox) => {
                      const selectable =
                        inbox.status === "warmed" || inbox.status === "warming";
                      return (
                        <label
                          key={inbox._id}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2.5 text-sm",
                            selectable
                              ? "cursor-pointer hover:bg-accent"
                              : "cursor-not-allowed opacity-50",
                          )}
                        >
                          <Checkbox
                            disabled={!selectable}
                            checked={selectedInboxes.has(inbox._id)}
                            onCheckedChange={(checked) => {
                              const nextSet = new Set(selectedInboxes);
                              if (checked) nextSet.add(inbox._id);
                              else nextSet.delete(inbox._id);
                              setSelectedInboxes(nextSet);
                            }}
                          />
                          <span className="min-w-0 truncate">{inbox.email}</span>
                          <StatusBadge status={inbox.status} className="shrink-0" />
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {inbox.dailyLimit}/day
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {inboxes.some(
                  (i) => selectedInboxes.has(i._id) && i.status === "warming",
                ) && (
                  <p className="mt-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
                    Some selected inboxes are still warming. Sending is allowed,
                    but keep the daily cap low (10–20/day) until they&apos;re
                    warmed — high volume from a cold inbox hurts deliverability.
                  </p>
                )}
              </div>
            )}

            {stepIdx === 5 && (
              <dl className="space-y-3 text-sm">
                {[
                  ["Campaign", name],
                  ["Leads", `${selectedLeads.size} selected`],
                  [
                    "Sequence",
                    `${sequence.length} email${sequence.length === 1 ? "" : "s"}, ` +
                      `${sequence.reduce((n, s) => n + s.variants.filter((v) => v.trim()).length, 0)} script variations`,
                  ],
                  ["Window", `${windowStart}–${windowEnd} ${timezone}`],
                  ["Daily cap", `${dailyCap} emails/day`],
                  ["Inboxes", `${selectedInboxes.size} inbox${selectedInboxes.size === 1 ? "" : "es"}`],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-border pb-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
                <p className="pt-1 text-xs text-muted-foreground">
                  The campaign is saved as a draft — you activate it from the
                  campaigns list, and can pause it anytime.
                </p>
              </dl>
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between border-t pt-4">
          <Button
            variant="outline"
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            disabled={stepIdx === 0}
          >
            <ArrowLeft className="size-4" /> Back
          </Button>
          {stepIdx < WIZARD_STEPS.length - 1 ? (
            <Button onClick={next}>
              Next <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button onClick={publish} disabled={publishing}>
              {publishing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Rocket className="size-4" />
              )}
              Create campaign
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
