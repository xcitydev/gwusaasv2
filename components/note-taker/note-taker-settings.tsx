"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Copy, Loader2, Settings2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { friendlyError, type Overview } from "./shared";

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} aria-label={label} className="font-mono text-xs" />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        title="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

export function NoteTakerSettings({ overview }: { overview: Overview }) {
  const save = useMutation(api.noteTaker.saveSettings);
  const rotateToken = useMutation(api.noteTaker.rotateCalcomToken);
  const connectUrl = useAction(api.noteTakerActions.calendarConnectUrl);
  const disconnect = useAction(api.noteTakerActions.disconnectCalendar);
  const { settings } = overview;

  const [open, setOpen] = useState(false);
  const [botName, setBotName] = useState(settings.botName);
  const [announce, setAnnounce] = useState(settings.announce);
  const [audience, setAudience] = useState(settings.recapAudience);
  const [extras, setExtras] = useState(settings.recapExtraEmails.join(", "));
  const [retention, setRetention] = useState(String(settings.retentionDays));
  const [autoJoin, setAutoJoin] = useState(settings.autoJoin);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Fresh copy of the saved settings every time the dialog opens.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setBotName(settings.botName);
      setAnnounce(settings.announce);
      setAudience(settings.recapAudience);
      setExtras(settings.recapExtraEmails.join(", "));
      setRetention(String(settings.retentionDays));
      setAutoJoin(settings.autoJoin);
    }
    setOpen(next);
  };

  const doSave = async () => {
    setSaving(true);
    try {
      await save({
        botName,
        announce,
        recapAudience: audience,
        recapExtraEmails: extras.split(/[,\s]+/).filter(Boolean),
        retentionDays: Number(retention) || 30,
        autoJoin,
      });
      toast.success("Note taker settings saved.");
      setOpen(false);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't save the settings."));
    } finally {
      setSaving(false);
    }
  };

  const connect = async (provider: "google" | "microsoft") => {
    setBusy(provider);
    try {
      const { url } = await connectUrl({ provider });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't start the calendar connection."));
    } finally {
      setBusy(null);
    }
  };

  const doDisconnect = async (calendarDocId: Id<"noteTakerCalendars">) => {
    setBusy(calendarDocId);
    try {
      await disconnect({ calendarDocId });
      toast.success("Calendar disconnected.");
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't disconnect that calendar."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 className="size-4" /> Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Note taker settings</DialogTitle>
          <DialogDescription>
            How the bot shows up, who gets the recap, and which meetings it
            joins on its own.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nt-bot-name">Bot name in the meeting</Label>
              <Input
                id="nt-bot-name"
                value={botName}
                maxLength={100}
                onChange={(e) => setBotName(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Announce the recording</p>
                <p className="text-xs text-muted-foreground">
                  Posts a chat message on joining so everyone knows notes are
                  being taken. Recommended — recording-consent rules vary.
                </p>
              </div>
              <Switch
                checked={announce}
                onCheckedChange={setAnnounce}
                aria-label="Announce the recording"
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="space-y-1.5">
              <Label>Recap email goes to</Label>
              <Select
                value={audience}
                onValueChange={(value) => setAudience(value as typeof audience)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="host">Just whoever sent the bot</SelectItem>
                  <SelectItem value="attendees">
                    The sender + invitees we have emails for
                  </SelectItem>
                  <SelectItem value="none">Nobody — keep notes in the app</SelectItem>
                </SelectContent>
              </Select>
              {!overview.emailConfigured && (
                <p className="text-xs text-amber-400">
                  Email isn&apos;t switched on for the platform yet — recaps
                  stay in the app until it is.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-extras">Always CC (optional)</Label>
              <Input
                id="nt-extras"
                value={extras}
                onChange={(e) => setExtras(e.target.value)}
                placeholder="ops@company.com, manager@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-retention">Keep recordings for (days)</Label>
              <Input
                id="nt-retention"
                type="number"
                min={1}
                max={365}
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Notes and transcripts stay; the video is deleted after this.
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-sm font-medium">Calendars</p>
            {overview.calendars.map((calendar) => (
              <div
                key={calendar._id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {calendar.email ??
                      (calendar.platform === "google_calendar"
                        ? "Google Calendar"
                        : "Outlook")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {calendar.platform === "google_calendar" ? "Google" : "Outlook"}
                    {calendar.status === "disconnected" && " · needs reconnecting"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void doDisconnect(calendar._id)}
                >
                  {busy === calendar._id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Unplug className="size-4" />
                  )}
                  Disconnect
                </Button>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["google", "Google Calendar"],
                  ["microsoft", "Outlook"],
                ] as const
              ).map(([provider, label]) => (
                <Button
                  key={provider}
                  variant="outline"
                  disabled={
                    busy !== null ||
                    !overview.configured ||
                    !overview.calendarProviders[provider]
                  }
                  title={
                    overview.calendarProviders[provider]
                      ? undefined
                      : "Not set up on the platform yet"
                  }
                  onClick={() => void connect(provider)}
                >
                  {busy === provider && <Loader2 className="size-4 animate-spin" />}
                  Connect {label}
                </Button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Meetings on a connected calendar</Label>
              <Select
                value={autoJoin}
                onValueChange={(value) => setAutoJoin(value as typeof autoJoin)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">I pick which ones to record</SelectItem>
                  <SelectItem value="all">
                    Record every meeting that has a link
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-sm font-medium">Cal.com bookings</p>
            <p className="text-xs text-muted-foreground">
              Add this as a webhook in Cal.com (Settings → Developer → Webhooks;
              events: Booking created, rescheduled, cancelled) and every booking
              with a Zoom, Meet or Teams link gets a note taker automatically.
            </p>
            {overview.calcomWebhookUrl ? (
              <CopyField value={overview.calcomWebhookUrl} label="Cal.com webhook URL" />
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={async () => {
                setBusy("calcom");
                try {
                  await rotateToken({});
                } catch (e) {
                  toast.error(friendlyError(e, "Couldn't create the webhook URL."));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "calcom" && <Loader2 className="size-4 animate-spin" />}
              {overview.calcomWebhookUrl ? "Rotate URL" : "Create webhook URL"}
            </Button>
          </section>

          {overview.isAdmin && overview.webhookUrl && (
            <section className="space-y-2 rounded-lg border border-dashed border-border p-3">
              <p className="text-sm font-medium">Admin · Recall webhook</p>
              <p className="text-xs text-muted-foreground">
                Add in the Recall dashboard (Webhooks) for instant status
                updates; set RECALL_WEBHOOK_SECRET to enforce signatures.
                Without it, a once-a-minute poll does the same job.
              </p>
              <CopyField value={overview.webhookUrl} label="Recall webhook URL" />
            </section>
          )}
        </div>

        <DialogFooter>
          <Button onClick={doSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
