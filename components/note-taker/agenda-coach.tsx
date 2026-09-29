"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import {
  CalendarClock,
  ClipboardList,
  Compass,
  ExternalLink,
  ListChecks,
  Loader2,
  MessageSquareText,
  Plus,
  Send,
  Trash2,
  Video,
  VideoOff,
} from "lucide-react";
import {
  formatClock,
  type AgendaItem,
  type CoachState,
  type TaskRouting,
} from "@/lib/note-taker";
import { cn } from "@/lib/utils";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ListSkeleton } from "@/components/list-skeleton";
import { AgendaProgress, TalkBalance, liveElapsed } from "./coach-card";
import { StatusBadge, friendlyError, platformLabel, whenLabel, type Overview } from "./shared";

/**
 * The Agenda Coach tab: workspace settings for live coaching, the private
 * live panel for meetings in progress, an agenda planner for upcoming
 * meetings, and where action items were routed after each call.
 */
export function AgendaCoach({ overview }: { overview: Overview }) {
  const meetings = useQuery(api.noteTakerCoach.listCoachMeetings);
  const live = (meetings ?? []).filter((m) =>
    ["recording", "joining", "waiting_room"].includes(m.status),
  );
  return (
    <div className="space-y-6">
      <CoachSettings overview={overview} />
      {live.map((m) => (
        <LivePanel key={m._id} meetingId={m._id} />
      ))}
      <AgendaPlanner meetings={meetings} />
      <TaskRoutingCard />
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────

function CoachSettings({ overview }: { overview: Overview }) {
  const save = useMutation(api.noteTakerCoach.saveCoachSettings);
  const s = overview.settings;
  const [enabled, setEnabled] = useState(s.coachEnabled);
  const [chat, setChat] = useState(s.coachChat);
  const [tile, setTile] = useState(s.coachTile);
  const [nudgeMin, setNudgeMin] = useState(String(s.coachNudgeMin));
  const [saving, setSaving] = useState(false);
  const dirty =
    enabled !== s.coachEnabled ||
    chat !== s.coachChat ||
    tile !== s.coachTile ||
    Number(nudgeMin) !== s.coachNudgeMin;

  const submit = async () => {
    setSaving(true);
    try {
      await save({
        coachEnabled: enabled,
        coachChat: chat,
        coachTile: tile,
        coachNudgeMin: Number(nudgeMin) || 3,
      });
      toast.success("Coach settings saved — they apply to the next bot that joins.");
    } catch (e) {
      toast.error(friendlyError(e, "Could not save."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Compass className="size-4 text-primary" /> Live coaching
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          While the note taker records, an AI coach follows the agenda: it flags drift,
          overrun timeboxes and one-sided talk time, and suggests the next question. Nudges
          show here, in the meeting chat, and on a coach card the bot can show as its camera.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ToggleRow
          label="Enable the agenda coach"
          help="Switches the bot to real-time transcription for meetings this workspace records."
          checked={enabled}
          onChange={setEnabled}
        />
        <ToggleRow
          label="Post nudges in the meeting chat"
          help="As the bot, visible to everyone — Zoom, Google Meet and Microsoft Teams. Good for internal meetings; switch off for client calls."
          checked={chat}
          onChange={setChat}
          disabled={!enabled}
        />
        <ToggleRow
          label="Show the coach card as the bot's camera"
          help={
            overview.appUrlConfigured
              ? "The bot's video tile becomes a live agenda board (Zoom, Meet, Teams, Webex)."
              : overview.isAdmin
                ? "Needs the app's public address first: npx convex env set APP_URL https://your-domain — then the bot can load the card."
                : "Not available yet — an admin needs to set the app's public address."
          }
          checked={tile}
          onChange={setTile}
          disabled={!enabled || !overview.appUrlConfigured}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="nudge-min" className="text-sm">
            At most one chat nudge every
          </Label>
          <Input
            id="nudge-min"
            inputMode="numeric"
            value={nudgeMin}
            onChange={(e) => setNudgeMin(e.target.value)}
            className="w-20"
            disabled={!enabled || !chat}
          />
          <span className="text-sm text-muted-foreground">minutes</span>
          <Button className="ml-auto" onClick={submit} disabled={!dirty || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />} Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", disabled && "opacity-60")}>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

// ── Live panel ──────────────────────────────────────────────────────────

function LivePanel({ meetingId }: { meetingId: Id<"meetings"> }) {
  const data = useQuery(api.noteTakerCoach.coachLive, { meetingId });
  const postNudge = useAction(api.noteTakerCoach.postNudge);
  const setTile = useAction(api.noteTakerCoach.setTile);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"chat" | "tile" | null>(null);
  const [, setClock] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClock((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!data) return null;
  const state = (data.coachState as CoachState | null) ?? null;
  const live = data.status === "recording";
  const elapsed = liveElapsed(state, live);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy("chat");
    try {
      await postNudge({ meetingId, message: trimmed });
      toast.success("Posted in the meeting chat.");
      setMessage("");
    } catch (e) {
      toast.error(friendlyError(e, "Could not post."));
    } finally {
      setBusy(null);
    }
  };

  const toggleTile = async () => {
    setBusy("tile");
    try {
      await setTile({ meetingId, on: !data.tileOn });
      toast.success(data.tileOn ? "Coach card hidden." : "Coach card is now the bot camera.");
    } catch (e) {
      toast.error(friendlyError(e, "Could not switch the coach card."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="size-2 animate-pulse rounded-full bg-red-400" />
            <span className="truncate">{data.title}</span>
            <StatusBadge status={data.status} />
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {platformLabel(data.platform)} · {formatClock(elapsed)} elapsed
            {state?.topic ? ` · now: ${state.topic}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.tileSupported && (
            <Button variant="outline" size="sm" onClick={toggleTile} disabled={busy !== null}>
              {busy === "tile" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : data.tileOn ? (
                <VideoOff className="size-4" />
              ) : (
                <Video className="size-4" />
              )}
              {data.tileOn ? "Hide coach card" : "Show coach card"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          {data.agenda.length > 0 ? (
            <AgendaProgress agenda={data.agenda} state={state} elapsedSec={elapsed} compact />
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No agenda for this meeting — add one below and the coach starts timing items on
              its next pass.
            </p>
          )}
          {state && state.talk.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Talk time
              </p>
              <TalkBalance talk={state.talk} compact />
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div
            className={cn(
              "rounded-xl border p-4",
              state?.nudge
                ? state.nudgeKind === "overrun"
                  ? "border-red-400/40 bg-red-500/10"
                  : "border-primary/40 bg-primary/10"
                : "border-border bg-secondary/40",
            )}
          >
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {state?.nudge ? "Latest nudge" : "Coach"}
            </p>
            <p className="mt-1 text-sm font-medium">
              {state?.nudge ?? (live ? "Listening — nothing to flag yet." : "Starts when the recording starts.")}
            </p>
            {state?.suggestion && (
              <div className="mt-3 flex items-start gap-2">
                <p className="flex-1 text-sm text-muted-foreground">Try: “{state.suggestion}”</p>
                {data.chatSupported && data.settings.chat && (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => send(state.suggestion!)}>
                    <Send className="size-3.5" /> Post
                  </Button>
                )}
              </div>
            )}
          </div>
          {data.chatSupported ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(message);
              }}
            >
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Post a nudge in the meeting chat…"
                maxLength={500}
              />
              <Button type="submit" size="sm" disabled={busy !== null || !message.trim()}>
                {busy === "chat" ? <Loader2 className="size-4 animate-spin" /> : <MessageSquareText className="size-4" />}
              </Button>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">
              Bots cannot post in chat on {platformLabel(data.platform)} — nudges stay on this panel.
            </p>
          )}
          {data.events.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Nudge log
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                {data.events.map((e) => (
                  <li key={e._id} className="flex gap-2 text-muted-foreground">
                    <span className="shrink-0 font-mono">
                      {new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground/80">{e.message}</span>{" "}
                      <span className="text-muted-foreground/70">· {e.channels.join(", ")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.recent.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Live transcript
              </p>
              <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {data.recent.map((s, i) => (
                  <li key={i}>
                    <span className="font-mono">[{formatClock(s.start)}]</span>{" "}
                    <span className="text-foreground/80">{s.speaker}:</span> {s.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Agenda planner ──────────────────────────────────────────────────────

type CoachMeeting = FunctionReturnType<typeof api.noteTakerCoach.listCoachMeetings>[number];

function AgendaPlanner({ meetings }: { meetings: CoachMeeting[] | undefined }) {
  const [editing, setEditing] = useState<CoachMeeting | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-primary" /> Agendas for upcoming meetings
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Give each scheduled meeting its agenda and time budgets. The coach measures every
          item against them; you can edit an agenda while the meeting is running.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {meetings === undefined ? (
          <div className="p-4">
            <ListSkeleton rows={2} />
          </div>
        ) : meetings.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing scheduled. Record a meeting or connect a calendar on the Meetings tab, then
            add its agenda here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {meetings.map((m) => {
              const total = m.agenda.reduce((sum, item) => sum + item.minutes, 0);
              return (
                <li key={m._id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{m.title}</p>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {platformLabel(m.platform)}
                      {m.scheduledFor ? ` · ${whenLabel(m.scheduledFor)}` : ""}
                      {m.agenda.length > 0
                        ? ` · ${m.agenda.length} item${m.agenda.length === 1 ? "" : "s"}, ${total} min`
                        : " · no agenda yet"}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setEditing(m)}>
                    <ClipboardList className="size-4" /> {m.agenda.length > 0 ? "Edit agenda" : "Set agenda"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {editing && (
        <AgendaDialog
          meeting={editing}
          onClose={() => setEditing(null)}
          template={meetings?.find((m) => m.agenda.length > 0 && m._id !== editing._id)?.agenda ?? null}
        />
      )}
    </Card>
  );
}

function AgendaDialog({
  meeting,
  template,
  onClose,
}: {
  meeting: CoachMeeting;
  template: AgendaItem[] | null;
  onClose: () => void;
}) {
  const setAgenda = useMutation(api.noteTakerCoach.setAgenda);
  const [items, setItems] = useState<AgendaItem[]>(
    meeting.agenda.length > 0 ? meeting.agenda : [{ title: "", minutes: 10 }],
  );
  const [saving, setSaving] = useState(false);
  const total = items.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);

  const update = (index: number, patch: Partial<AgendaItem>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const submit = async () => {
    const clean = items
      .map((item) => ({ title: item.title.trim(), minutes: Number(item.minutes) || 0 }))
      .filter((item) => item.title);
    setSaving(true);
    try {
      await setAgenda({ meetingId: meeting._id, agenda: clean });
      toast.success(clean.length > 0 ? "Agenda saved." : "Agenda cleared.");
      onClose();
    } catch (e) {
      toast.error(friendlyError(e, "Could not save the agenda."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agenda — {meeting.title}</DialogTitle>
          <DialogDescription>
            Items in order with a minute budget each. Total: {total} min.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-5 text-right text-xs text-muted-foreground">{index + 1}.</span>
              <Input
                value={item.title}
                onChange={(e) => update(index, { title: e.target.value })}
                placeholder="e.g. Pricing review"
                className="flex-1"
                autoFocus={index === items.length - 1 && !item.title}
              />
              <Input
                inputMode="numeric"
                value={String(item.minutes)}
                onChange={(e) => update(index, { minutes: Number(e.target.value.replace(/\D/g, "")) })}
                className="w-16 text-center"
                aria-label="Minutes"
              />
              <span className="text-xs text-muted-foreground">min</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove item"
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setItems((prev) => [...prev, { title: "", minutes: 10 }])}
              disabled={items.length >= 20}
            >
              <Plus className="size-4" /> Add item
            </Button>
            {template && meeting.agenda.length === 0 && (
              <Button variant="ghost" size="sm" onClick={() => setItems(template)}>
                Reuse the last agenda
              </Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />} Save agenda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Task routing ────────────────────────────────────────────────────────

function TaskRoutingCard() {
  const integrations = useQuery(api.integrations.list) ?? [];
  const recent = useQuery(api.noteTakerCoach.recentRouting);
  const routeNow = useAction(api.integrations.routeNow);
  const [busy, setBusy] = useState<Id<"meetings"> | null>(null);
  const connected = integrations.filter((i) => i.status === "connected");

  const resend = async (meetingId: Id<"meetings">) => {
    setBusy(meetingId);
    try {
      const result = await routeNow({ meetingId });
      const created = result?.results.reduce((sum, r) => sum + r.created, 0) ?? 0;
      const failed = result?.results.filter((r) => !r.ok) ?? [];
      if (failed.length > 0) toast.error(`${failed[0].provider}: ${failed[0].error}`);
      else toast.success(created > 0 ? `${created} task${created === 1 ? "" : "s"} sent.` : "No action items to send.");
    } catch (e) {
      toast.error(friendlyError(e, "Could not send."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="size-4 text-primary" /> Action items → your task tools
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            When the notes are written, every action item (owner, deadline) becomes a task in
            the tools connected in Settings.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/settings?tab=integrations">
            <ExternalLink className="size-4" /> Integrations
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {connected.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              Nothing connected yet — Trello, Asana or a webhook (Zapier, Make, n8n).
            </span>
          ) : (
            connected.map((i) => (
              <Badge key={i.provider} variant="outline" className="border-primary/40 text-primary">
                {i.provider === "trello" ? "Trello" : i.provider === "asana" ? "Asana" : "Webhook"}
                {i.autoRoute ? " · auto" : " · manual"}
              </Badge>
            ))
          )}
        </div>
        {recent === undefined ? (
          <ListSkeleton rows={2} />
        ) : recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Finished meetings with notes show up here.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {recent.map((m) => {
              const routing = m.taskRouting as TaskRouting | null;
              const sent = routing?.results.filter((r) => r.ok) ?? [];
              const failed = routing?.results.filter((r) => !r.ok) ?? [];
              return (
                <li key={m._id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {whenLabel(m.endedAt)} · {m.actionItemCount} action item{m.actionItemCount === 1 ? "" : "s"}
                      {sent.length > 0 && ` · sent to ${sent.map((r) => `${r.provider} (${r.created})`).join(", ")}`}
                      {failed.length > 0 && ` · ${failed[0].provider}: ${failed[0].error}`}
                      {!routing && " · not sent"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null || connected.length === 0 || m.actionItemCount === 0}
                    onClick={() => resend(m._id)}
                  >
                    {busy === m._id ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-3.5" />}
                    {routing ? "Send again" : "Send now"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
