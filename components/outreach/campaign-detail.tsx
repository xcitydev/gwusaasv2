"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  ArrowLeft,
  Inbox,
  Loader2,
  MailOpen,
  MessageSquareReply,
  Pause,
  Play,
  Plus,
  Save,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import {
  SequenceEditor,
  type SequenceStep,
} from "@/components/outreach/sequence-editor";
import { StatusBadge } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CsvImportButton } from "@/components/leads/csv-import-button";
import { CAMPAIGN_TIMEZONES, toEngineTimezone } from "@/lib/timezones";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";


type CampaignData = NonNullable<
  ReturnType<typeof useQuery<typeof api.outreach.getCampaign>>
>;
type InboxList = NonNullable<
  ReturnType<typeof useQuery<typeof api.outreach.listInboxes>>
>;

export function CampaignDetail({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const campaign = useQuery(api.outreach.getCampaign, { id: campaignId });
  const allInboxes = useQuery(api.outreach.listInboxes) ?? [];

  if (campaign === undefined) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (campaign === null) {
    return (
      <div className="py-24 text-center">
        <p className="font-medium">Campaign not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/outreach">Back to Outreach</Link>
        </Button>
      </div>
    );
  }
  // Keyed so the editor re-seeds if the route switches campaigns.
  return (
    <CampaignEditor key={campaign._id} campaign={campaign} allInboxes={allInboxes} />
  );
}

function CampaignEditor({
  campaign,
  allInboxes,
}: {
  campaign: CampaignData;
  allInboxes: InboxList;
}) {
  const campaignId = campaign._id;
  const router = useRouter();
  const updateCampaign = useAction(api.outreachActions.updateCampaign);
  const setStatus = useAction(api.outreachActions.setCampaignStatus);
  const removeCampaign = useMutation(api.outreach.removeCampaign);

  // Editable copy, initialized from the loaded campaign on mount. Live query
  // updates keep the stats fresh without clobbering in-progress edits.
  const [name, setName] = useState(campaign.name);
  const [steps, setSteps] = useState<SequenceStep[]>(() =>
    campaign.steps.map((s) => ({
      waitDays: s.waitDays,
      subject: s.subject,
      variants: s.variants.length > 0 ? s.variants : [""],
    })),
  );
  const [windowStart, setWindowStart] = useState(campaign.sendWindowStart);
  const [windowEnd, setWindowEnd] = useState(campaign.sendWindowEnd);
  // Legacy stored zones (pre enum discovery) snap to their engine equivalent.
  const [timezone, setTimezone] = useState(toEngineTimezone(campaign.timezone));
  const [dailyCap, setDailyCap] = useState(String(campaign.dailyCap));
  const [inboxIds, setInboxIds] = useState<Set<string>>(
    () => new Set(campaign.inboxIds),
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  // Add-leads dialog
  const addLeads = useAction(api.outreachActions.addCampaignLeads);
  const storeLeads = useQuery(api.leads.list) ?? [];
  const [addLeadsOpen, setAddLeadsOpen] = useState(false);
  const [pickIds, setPickIds] = useState<Set<string>>(new Set());
  const [quickText, setQuickText] = useState("");
  const [addingLeads, setAddingLeads] = useState(false);
  const attachedIds = new Set(campaign.leads.map((l) => l._id));
  const availableLeads = storeLeads.filter((l) => !attachedIds.has(l._id));

  const submitAddLeads = async () => {
    // Quick-add lines: "email" or "name, email" in either order — the token
    // containing @ is the email, the rest becomes the name.
    const quickAdd = quickText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const tokens = line.split(/[,;\t]+/).map((t) => t.trim()).filter(Boolean);
        const email = tokens.find((t) => t.includes("@")) ?? "";
        const name = tokens.filter((t) => t !== email).join(" ") || undefined;
        return { email, name };
      })
      .filter((row) => row.email.includes("@"));

    if (pickIds.size === 0 && quickAdd.length === 0) {
      toast.error("Pick leads or add at least one email line.");
      return;
    }
    setAddingLeads(true);
    try {
      const result = await addLeads({
        id: campaignId,
        leadIds: [...pickIds] as Id<"leads">[],
        quickAdd,
      });
      const summary =
        `Added ${result.added} lead${result.added === 1 ? "" : "s"}` +
        (result.alreadyIn > 0 ? ` — ${result.alreadyIn} already in the campaign` : "");
      if (result.engineSynced) {
        toast.success(
          campaign.instantlyId ? `${summary}. Synced to the email engine.` : `${summary}.`,
        );
      } else {
        toast.warning(
          `${summary}, but the email engine rejected them: ${result.engineError ?? "unknown error"}`,
          { duration: 8000 },
        );
      }
      setAddLeadsOpen(false);
      setPickIds(new Set());
      setQuickText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add leads.");
    } finally {
      setAddingLeads(false);
    }
  };

  const stats = [
    { label: "Leads", value: campaign.leadCount, icon: Users },
    { label: "Sent", value: campaign.stats?.sent ?? 0, icon: Send },
    { label: "Opened", value: campaign.stats?.opened ?? 0, icon: MailOpen },
    { label: "Replies", value: campaign.stats?.replied ?? 0, icon: MessageSquareReply },
  ];

  const save = async () => {
    setSaving(true);
    try {
      const result = await updateCampaign({
        id: campaignId,
        name,
        steps,
        sendWindowStart: windowStart,
        sendWindowEnd: windowEnd,
        timezone,
        dailyCap: Number(dailyCap) || 1,
        inboxIds: [...inboxIds] as Id<"inboxes">[],
      });
      if (result.engineSynced) {
        toast.success(
          campaign.instantlyId
            ? "Saved — changes synced to the email engine."
            : "Campaign saved.",
        );
      } else {
        toast.warning(
          `Saved locally, but the email engine rejected the update: ${result.engineError ?? "unknown error"}`,
          { duration: 8000 },
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status: "active" | "paused") => {
    setStatusBusy(true);
    try {
      await setStatus({ id: campaignId, status });
      toast.success(status === "active" ? "Campaign is live." : "Campaign paused.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status change failed.");
    } finally {
      setStatusBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground">
        <Link href="/outreach">
          <ArrowLeft className="size-4" /> Outreach
        </Link>
      </Button>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-auto max-w-sm border-transparent bg-transparent px-1 py-0.5 text-2xl font-semibold tracking-tight hover:border-border focus-visible:border-border sm:text-3xl"
            aria-label="Campaign name"
          />
          <StatusBadge status={campaign.status} />
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === "active" ? (
            <Button variant="outline" disabled={statusBusy} onClick={() => changeStatus("paused")}>
              <Pause className="size-4" /> Pause
            </Button>
          ) : (
            <Button disabled={statusBusy} onClick={() => changeStatus("active")}>
              <Play className="size-4" />
              {campaign.status === "draft" ? "Publish" : "Resume"}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label="Delete campaign"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <stat.icon className="size-4.5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-lg font-semibold">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sequence & script</CardTitle>
          </CardHeader>
          <CardContent>
            <SequenceEditor
              steps={steps}
              onChange={setSteps}
              previewLeads={campaign.leads}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schedule</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Sending inboxes ({inboxIds.size} selected)
            </CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link href="/outreach">
                <Plus className="size-3.5" /> Add inboxes
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {allInboxes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No inboxes connected yet.
              </p>
            ) : (
              <div className="divide-y divide-border rounded-lg border">
                {allInboxes.map((inbox) => {
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
                        checked={inboxIds.has(inbox._id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(inboxIds);
                          if (checked) next.add(inbox._id);
                          else next.delete(inbox._id);
                          setInboxIds(next);
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Leads ({campaign.leadCount})
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setAddLeadsOpen(true)}>
              <Plus className="size-3.5" /> Add leads
            </Button>
          </CardHeader>
          <CardContent>
            {campaign.leads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No leads attached.</p>
            ) : (
              <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border">
                {campaign.leads.map((lead) => (
                  <div key={lead._id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Inbox className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {lead.name ?? lead.email}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {lead.company ?? lead.email}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              You can add leads anytime — removing attached leads isn&apos;t
              supported, so create a new campaign for a different list.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Save bar */}
      <div className="sticky bottom-4 mt-8 flex justify-end">
        <Button size="lg" onClick={save} disabled={saving} className="min-w-40 shadow-lg">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save changes
        </Button>
      </div>

      <Dialog open={addLeadsOpen} onOpenChange={setAddLeadsOpen}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add leads to {campaign.name}</DialogTitle>
            <DialogDescription>
              New leads join the queue immediately
              {campaign.instantlyId ? " and sync to the email engine" : ""}.
              Duplicates are skipped automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>From your leads ({pickIds.size} selected)</Label>
                <CsvImportButton
                  sourceDetail={`Campaign: ${campaign.name}`}
                  onImported={(ids) =>
                    setPickIds((prev) => new Set([...prev, ...ids]))
                  }
                />
              </div>
              {availableLeads.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  Every saved lead is already in this campaign — quick-add below
                  or import a CSV.
                </p>
              ) : (
                <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border">
                  {availableLeads.map((lead) => (
                    <label
                      key={lead._id}
                      className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
                    >
                      <Checkbox
                        checked={pickIds.has(lead._id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(pickIds);
                          if (checked) next.add(lead._id);
                          else next.delete(lead._id);
                          setPickIds(next);
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {lead.name ?? lead.email}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {lead.email}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label className="mb-2">Quick add — one per line</Label>
              <Textarea
                rows={4}
                placeholder={"jane@acme.com\nJohn Smith, john@corp.com"}
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Just an email, or name and email separated by a comma — order
                doesn&apos;t matter. They&apos;re saved to Find Customers too.
              </p>
            </div>
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setAddLeadsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitAddLeads} disabled={addingLeads}>
              {addingLeads ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {campaign.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The sequence and lead assignments are removed. Your leads stay in
              Find Customers. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await removeCampaign({ id: campaignId });
                  toast.success("Campaign deleted.");
                  router.push("/outreach");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Delete failed.");
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
