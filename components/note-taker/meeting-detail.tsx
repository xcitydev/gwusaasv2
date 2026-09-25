"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  Download,
  Loader2,
  Mail,
  Play,
  Send,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ListSkeleton } from "@/components/list-skeleton";
import {
  ACTIVE_STATUSES,
  formatClock,
  formatDuration,
  notesToMarkdown,
  type MeetingAnalytics,
  type MeetingNotes,
} from "@/lib/note-taker";
import { cn } from "@/lib/utils";
import { StatusBadge, friendlyError, platformLabel, whenLabel } from "./shared";

type Meeting = Doc<"meetings">;

/** "12:04" / "1:02:05" → seconds. */
function clockToSec(clock: string): number {
  return clock
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

/** Text with [12:04] marks turned into jump-to-moment buttons. */
function Timestamped({
  text,
  onSeek,
}: {
  text: string;
  onSeek: (sec: number) => void;
}) {
  const parts = text.split(/(\[(?:\d{1,2}:)?\d{1,2}:\d{2}\])/g);
  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/^\[((?:\d{1,2}:)?\d{1,2}:\d{2})\]$/);
        if (!match) return <span key={index}>{part}</span>;
        return (
          <button
            key={index}
            type="button"
            onClick={() => onSeek(clockToSec(match[1]))}
            className="mx-0.5 rounded bg-primary/15 px-1 py-0.5 font-mono text-[11px] text-primary hover:bg-primary/25"
          >
            {match[1]}
          </button>
        );
      })}
    </>
  );
}

export function MeetingDetail({
  meetingId,
  focusSec,
  onBack,
}: {
  meetingId: Id<"meetings">;
  focusSec: number | null;
  onBack: () => void;
}) {
  const meeting = useQuery(api.noteTaker.getMeeting, { meetingId });
  const getRecordingUrl = useAction(api.noteTakerActions.getRecordingUrl);
  const [tab, setTab] = useState(focusSec !== null ? "transcript" : "notes");
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<
    "idle" | "loading" | "missing"
  >("idle");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingSeek = useRef<number | null>(null);

  const loadRecording = async () => {
    setRecordingState("loading");
    try {
      const { url } = await getRecordingUrl({ meetingId });
      setRecordingUrl(url);
      setRecordingState(url ? "idle" : "missing");
    } catch {
      setRecordingState("missing");
    }
  };

  /** Jump the player to a moment (loading the recording first if needed). */
  const seek = (sec: number) => {
    const video = videoRef.current;
    if (video && recordingUrl) {
      video.currentTime = sec;
      void video.play().catch(() => {});
      return;
    }
    pendingSeek.current = sec;
    if (recordingState === "idle") void loadRecording();
  };

  if (meeting === undefined) return <ListSkeleton rows={5} />;
  if (meeting === null) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <p className="text-sm text-muted-foreground">
          This meeting no longer exists.
        </p>
      </div>
    );
  }

  const notes = (meeting.notes ?? null) as MeetingNotes | null;
  const analytics = (meeting.analytics ?? null) as MeetingAnalytics | null;
  const live =
    meeting.status === "scheduled" ||
    (ACTIVE_STATUSES as string[]).includes(meeting.status);
  const hasTranscript = Boolean(meeting.finalizedAt);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <BackButton onBack={onBack} />
          <TitleEditor meeting={meeting} />
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <StatusBadge status={meeting.status} />
            <span>
              {whenLabel(
                meeting.startedAt ?? meeting.scheduledFor ?? meeting._creationTime,
              )}
            </span>
            {meeting.durationSec ? (
              <span>· {formatDuration(meeting.durationSec)}</span>
            ) : null}
            <span>· {platformLabel(meeting.platform)}</span>
            {meeting.costCredits ? <span>· {meeting.costCredits} credits</span> : null}
          </p>
        </div>
        <DetailActions meeting={meeting} notes={notes} onDeleted={onBack} />
      </div>

      {meeting.statusDetail && (
        <p
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            meeting.status === "failed"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border bg-secondary/40 text-muted-foreground",
          )}
        >
          {meeting.statusDetail}
        </p>
      )}

      {live && !hasTranscript ? (
        <LiveCard meeting={meeting} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="notes">Notes</TabsTrigger>
                <TabsTrigger value="transcript">Transcript</TabsTrigger>
                <TabsTrigger value="ask">Ask AI</TabsTrigger>
                <TabsTrigger value="insights">Insights</TabsTrigger>
              </TabsList>
              <TabsContent value="notes">
                <NotesTab meeting={meeting} notes={notes} onSeek={seek} />
              </TabsContent>
              <TabsContent value="transcript">
                <TranscriptTab
                  meetingId={meetingId}
                  focusSec={focusSec}
                  onSeek={seek}
                />
              </TabsContent>
              <TabsContent value="ask">
                <AskTab meetingId={meetingId} enabled={hasTranscript} onSeek={seek} />
              </TabsContent>
              <TabsContent value="insights">
                <InsightsTab meeting={meeting} notes={notes} analytics={analytics} />
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="text-sm font-medium">Recording</p>
                {recordingUrl ? (
                  <video
                    ref={videoRef}
                    src={recordingUrl}
                    controls
                    className="w-full rounded-lg bg-black"
                    onLoadedMetadata={(e) => {
                      if (pendingSeek.current !== null) {
                        e.currentTarget.currentTime = pendingSeek.current;
                        pendingSeek.current = null;
                        void e.currentTarget.play().catch(() => {});
                      }
                    }}
                  />
                ) : recordingState === "missing" || meeting.mediaDeleted ? (
                  <p className="text-xs text-muted-foreground">
                    The video is no longer stored (retention period passed) — the
                    notes and transcript are kept.
                  </p>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadRecording()}
                    disabled={recordingState === "loading"}
                  >
                    {recordingState === "loading" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    Load recording
                  </Button>
                )}
              </CardContent>
            </Card>

            {notes && notes.chapters.length > 0 && (
              <Card>
                <CardContent className="space-y-1 p-4">
                  <p className="mb-2 text-sm font-medium">Chapters</p>
                  {notes.chapters.map((chapter, index) => (
                    <button
                      key={index}
                      onClick={() => seek(chapter.startSec)}
                      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                      title={chapter.summary}
                    >
                      <span className="mt-0.5 shrink-0 font-mono text-[11px] text-primary">
                        {formatClock(chapter.startSec)}
                      </span>
                      <span className="text-xs">{chapter.title}</span>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}

            {(meeting.attendees ?? []).length > 0 && (
              <Card>
                <CardContent className="space-y-1.5 p-4">
                  <p className="mb-1 text-sm font-medium">People</p>
                  {(meeting.attendees ?? []).map((person, index) => (
                    <p key={index} className="truncate text-xs">
                      {person.name}
                      {person.email && person.email !== person.name && (
                        <span className="text-muted-foreground"> · {person.email}</span>
                      )}
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" /> All meetings
    </button>
  );
}

function TitleEditor({ meeting }: { meeting: Meeting }) {
  const rename = useMutation(api.noteTaker.renameMeeting);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meeting.title);

  const commit = async () => {
    setEditing(false);
    const title = draft.trim();
    if (!title || title === meeting.title) return;
    try {
      await rename({ meetingId: meeting._id, title });
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't rename the meeting."));
    }
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-9 max-w-xl text-lg font-semibold"
        aria-label="Meeting title"
      />
    );
  }
  return (
    <h1
      className="cursor-text text-2xl font-semibold tracking-tight"
      title="Click to rename"
      onClick={() => {
        setDraft(meeting.title);
        setEditing(true);
      }}
    >
      {meeting.title}
    </h1>
  );
}

function DetailActions({
  meeting,
  notes,
  onDeleted,
}: {
  meeting: Meeting;
  notes: MeetingNotes | null;
  onDeleted: () => void;
}) {
  const emailRecap = useAction(api.noteTakerAi.emailRecap);
  const remove = useMutation(api.noteTaker.deleteMeeting);
  const [copied, setCopied] = useState(false);
  const [emailing, setEmailing] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {notes && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(notesToMarkdown(meeting.title, notes));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            Copy notes
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={emailing}
            onClick={async () => {
              setEmailing(true);
              try {
                const { sentTo } = await emailRecap({ meetingId: meeting._id });
                toast.success(`Recap sent to ${sentTo}.`);
              } catch (e) {
                toast.error(friendlyError(e, "Couldn't send the recap."));
              } finally {
                setEmailing(false);
              }
            }}
          >
            {emailing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Mail className="size-4" />
            )}
            Email me
          </Button>
        </>
      )}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Trash2 className="size-4" /> Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              The notes, transcript, chat and the stored recording are removed
              for good. Credits already spent aren&apos;t refunded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await remove({ meetingId: meeting._id });
                  toast.success("Meeting deleted.");
                  onDeleted();
                } catch (e) {
                  toast.error(friendlyError(e, "Couldn't delete the meeting."));
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

/** While the bot is scheduled / joining / recording / transcribing. */
function LiveCard({ meeting }: { meeting: Meeting }) {
  const stop = useAction(api.noteTakerActions.stopMeeting);
  const [stopping, setStopping] = useState(false);
  const steps: Record<string, string> = {
    scheduled: meeting.scheduledFor
      ? `The note taker joins at ${whenLabel(meeting.scheduledFor)}.`
      : "The note taker is scheduled.",
    joining: "The note taker is connecting to the call…",
    waiting_room:
      "It's in the waiting room — someone in the meeting needs to admit it.",
    recording: "Recording. Notes are written as soon as the call ends.",
    processing:
      "The call is over — transcribing and writing the notes. This usually takes a few minutes.",
  };
  return (
    <Card className="border-primary/20">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
          {meeting.status === "scheduled" ? (
            <Bot className="size-5" />
          ) : (
            <Loader2 className="size-5 animate-spin" />
          )}
        </span>
        <p className="max-w-md text-sm text-muted-foreground">
          {steps[meeting.status] ?? "Working…"}
        </p>
        {meeting.status !== "processing" && (
          <Button
            variant="outline"
            size="sm"
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              try {
                await stop({ meetingId: meeting._id });
              } catch (e) {
                toast.error(friendlyError(e, "Couldn't stop the note taker."));
              } finally {
                setStopping(false);
              }
            }}
          >
            {stopping ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Square className="size-3.5" />
            )}
            {meeting.status === "scheduled" ? "Skip this meeting" : "Stop recording"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Notes ───────────────────────────────────────────────────────────────

function NotesSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 text-sm text-foreground/90">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2">
          <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function NotesTab({
  meeting,
  notes,
  onSeek,
}: {
  meeting: Meeting;
  notes: MeetingNotes | null;
  onSeek: (sec: number) => void;
}) {
  const regenerate = useAction(api.noteTakerAi.regenerateNotes);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [retrying, setRetrying] = useState(false);
  if (!notes) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
          {meeting.notesStatus === "pending" ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Writing the notes…
            </span>
          ) : (
            <>
              <p>
                No AI notes for this meeting — the transcript tab has everything
                that was said.
              </p>
              {meeting.finalizedAt && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={retrying}
                  onClick={async () => {
                    setRetrying(true);
                    try {
                      await regenerate({ meetingId: meeting._id });
                    } catch (e) {
                      toast.error(friendlyError(e, "Couldn't start the notes."));
                    } finally {
                      setRetrying(false);
                    }
                  }}
                >
                  {retrying ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4 text-primary" />
                  )}
                  Write the notes again
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    );
  }
  const email = `Subject: ${notes.followUpEmail.subject}\n\n${notes.followUpEmail.body}`;
  return (
    <Card>
      <CardContent className="space-y-6 p-5">
        <NotesSection title="Summary">
          <p className="text-sm leading-relaxed text-foreground/90">{notes.summary}</p>
        </NotesSection>
        {notes.keyPoints.length > 0 && (
          <NotesSection title="Key points">
            <BulletList items={notes.keyPoints} />
          </NotesSection>
        )}
        {notes.decisions.length > 0 && (
          <NotesSection title="Decisions">
            <BulletList items={notes.decisions} />
          </NotesSection>
        )}
        {notes.actionItems.length > 0 && (
          <NotesSection title="Action items">
            <ul className="space-y-2">
              {notes.actionItems.map((item, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="mt-0.5 size-4 shrink-0 rounded border border-muted-foreground/50" />
                  <span className="min-w-0 flex-1">{item.task}</span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    {item.owner ?? "Unassigned"}
                    {item.due && <span className="block">{item.due}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </NotesSection>
        )}
        {notes.openQuestions.length > 0 && (
          <NotesSection title="Open questions">
            <BulletList items={notes.openQuestions} />
          </NotesSection>
        )}
        {notes.chapters.length > 0 && (
          <NotesSection title="How it went">
            <div className="space-y-2">
              {notes.chapters.map((chapter, index) => (
                <div key={index} className="flex gap-3 text-sm">
                  <button
                    onClick={() => onSeek(chapter.startSec)}
                    className="mt-0.5 h-fit shrink-0 rounded bg-primary/15 px-1 py-0.5 font-mono text-[11px] text-primary hover:bg-primary/25"
                  >
                    {formatClock(chapter.startSec)}
                  </button>
                  <p>
                    <span className="font-medium">{chapter.title}.</span>{" "}
                    <span className="text-muted-foreground">{chapter.summary}</span>
                  </p>
                </div>
              ))}
            </div>
          </NotesSection>
        )}
        <NotesSection title="Follow-up email draft">
          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <p className="text-sm font-medium">{notes.followUpEmail.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">
              {notes.followUpEmail.body}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                void navigator.clipboard.writeText(email);
                setCopiedEmail(true);
                setTimeout(() => setCopiedEmail(false), 1500);
              }}
            >
              {copiedEmail ? <Check className="size-4" /> : <Copy className="size-4" />}
              Copy email
            </Button>
          </div>
        </NotesSection>
      </CardContent>
    </Card>
  );
}

// ── Transcript ──────────────────────────────────────────────────────────

function TranscriptTab({
  meetingId,
  focusSec,
  onSeek,
}: {
  meetingId: Id<"meetings">;
  focusSec: number | null;
  onSeek: (sec: number) => void;
}) {
  const segments = useQuery(api.noteTaker.getTranscript, { meetingId });
  const [filter, setFilter] = useState("");
  const focusRef = useRef<HTMLDivElement | null>(null);

  // A search hit opens the transcript scrolled to the moment it was said.
  const focusIndex = useMemo(() => {
    if (focusSec === null || !segments) return -1;
    let best = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].start <= focusSec + 0.5) best = i;
    }
    return best;
  }, [focusSec, segments]);

  useEffect(() => {
    if (focusIndex >= 0) {
      focusRef.current?.scrollIntoView({ block: "center" });
    }
  }, [focusIndex]);

  if (segments === undefined) return <ListSkeleton rows={4} />;
  if (segments.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No speech was captured in this meeting.
        </CardContent>
      </Card>
    );
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? segments
        .map((segment, index) => ({ segment, index }))
        .filter(
          ({ segment }) =>
            segment.text.toLowerCase().includes(needle) ||
            segment.speaker.toLowerCase().includes(needle),
        )
    : segments.map((segment, index) => ({ segment, index }));

  const download = () => {
    const text = segments
      .map((s) => `[${formatClock(s.start)}] ${s.speaker}: ${s.text}`)
      .join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "transcript.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find in this transcript…"
            aria-label="Find in transcript"
          />
          <Button variant="outline" size="sm" className="shrink-0" onClick={download}>
            <Download className="size-4" /> .txt
          </Button>
        </div>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto p-4">
          {shown.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing matches “{filter}”.
            </p>
          )}
          {shown.map(({ segment, index }) => (
            <div
              key={index}
              ref={index === focusIndex ? focusRef : undefined}
              className={cn(
                "flex gap-3 rounded-lg",
                index === focusIndex && "bg-primary/10 p-2",
              )}
            >
              <button
                onClick={() => onSeek(segment.start)}
                className="mt-0.5 h-fit shrink-0 font-mono text-[11px] text-primary hover:underline"
                title="Play from here"
              >
                {formatClock(segment.start)}
              </button>
              <p className="text-sm leading-relaxed">
                <span className="font-medium">{segment.speaker}</span>{" "}
                <span className="text-foreground/85">{segment.text}</span>
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Ask AI ──────────────────────────────────────────────────────────────

const STARTER_QUESTIONS = [
  "What were the action items and who owns them?",
  "What objections or concerns came up?",
  "What was decided, and what's still open?",
];

function AskTab({
  meetingId,
  enabled,
  onSeek,
}: {
  meetingId: Id<"meetings">;
  enabled: boolean;
  onSeek: (sec: number) => void;
}) {
  const chat = useQuery(api.noteTaker.listChat, { meetingId }) ?? [];
  const ask = useAction(api.noteTakerAi.askMeeting);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.length, asking]);

  const submit = async (text: string) => {
    const value = text.trim();
    if (!value || asking) return;
    setAsking(true);
    setQuestion("");
    try {
      await ask({ meetingId, question: value });
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't get an answer."));
      setQuestion(value);
    } finally {
      setAsking(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex h-[65vh] flex-col p-0">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {chat.length === 0 && !asking && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Sparkles className="size-6 text-primary" />
              <p className="max-w-sm text-sm text-muted-foreground">
                Ask anything about this meeting — answers come only from what
                was said, with the moment cited.
              </p>
              <div className="flex flex-col gap-1.5">
                {STARTER_QUESTIONS.map((starter) => (
                  <button
                    key={starter}
                    disabled={!enabled}
                    onClick={() => void submit(starter)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chat.map((message) => (
            <div
              key={message._id}
              className={cn(
                "flex",
                message.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed",
                  message.role === "user"
                    ? "rounded-tr-sm bg-primary/15"
                    : "rounded-tl-sm bg-secondary",
                )}
              >
                {message.role === "assistant" ? (
                  <Timestamped text={message.content} onSeek={onSeek} />
                ) : (
                  message.content
                )}
              </div>
            </div>
          ))}
          {asking && (
            <div className="flex justify-start">
              <div className="rounded-xl rounded-tl-sm bg-secondary px-3 py-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 border-t border-border p-3">
          <Textarea
            className="h-12 min-h-12"
            value={question}
            disabled={!enabled}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              enabled
                ? "Ask about this meeting…"
                : "Available once the transcript is in"
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(question);
              }
            }}
          />
          <Button
            className="self-end"
            disabled={!enabled || asking || !question.trim()}
            onClick={() => void submit(question)}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Insights ────────────────────────────────────────────────────────────

const SENTIMENT_LABELS = {
  positive: "Positive",
  neutral: "Neutral",
  mixed: "Mixed",
  negative: "Tense",
} as const;

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function InsightsTab({
  meeting,
  notes,
  analytics,
}: {
  meeting: Meeting;
  notes: MeetingNotes | null;
  analytics: MeetingAnalytics | null;
}) {
  if (!analytics || analytics.speakers.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Insights appear once the transcript is in.
        </CardContent>
      </Card>
    );
  }
  const questions = analytics.speakers.reduce((sum, s) => sum + s.questions, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Meeting length"
          value={formatDuration(meeting.durationSec ?? 0)}
        />
        <StatTile label="Talk time" value={formatDuration(analytics.totalTalkSec)} />
        <StatTile label="Speakers" value={String(analytics.speakers.length)} />
        <StatTile label="Questions asked" value={String(questions)} />
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h3 className="text-sm font-semibold">Share of talk time</h3>
            <p className="text-xs text-muted-foreground">
              Who held the floor, as a share of all speaking time.
            </p>
          </div>
          {/* Magnitude across people → one hue, thin bars from one baseline;
              names and values stay in text ink, the bar carries the data. */}
          <TooltipProvider delayDuration={100}>
            <div className="space-y-2.5 border-l border-border pl-0">
              {analytics.speakers.map((speaker) => (
                <Tooltip key={speaker.name}>
                  <TooltipTrigger asChild>
                    <div className="grid cursor-default grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 py-0.5">
                      <span className="truncate pl-3 text-xs">{speaker.name}</span>
                      <div className="h-2.5">
                        <div
                          className="h-full rounded-r-[4px] bg-primary"
                          style={{ width: `${Math.max(speaker.share * 100, 0.75)}%` }}
                        />
                      </div>
                      <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">
                        {Math.round(speaker.share * 100)}% ·{" "}
                        {formatDuration(speaker.talkSec)}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {speaker.name}: {formatDuration(speaker.talkSec)} across{" "}
                    {speaker.turns} turn{speaker.turns === 1 ? "" : "s"} ·{" "}
                    {speaker.words.toLocaleString()} words
                    {speaker.wordsPerMinute > 0 && ` · ${speaker.wordsPerMinute} wpm`}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Speaker</th>
                  <th className="py-2 pr-3 text-right font-medium">Talk time</th>
                  <th className="py-2 pr-3 text-right font-medium">Turns</th>
                  <th className="py-2 pr-3 text-right font-medium">Words / min</th>
                  <th className="py-2 pr-3 text-right font-medium">Questions</th>
                  <th className="py-2 text-right font-medium">Longest stretch</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {analytics.speakers.map((speaker) => (
                  <tr key={speaker.name} className="border-b border-border/50">
                    <td className="max-w-40 truncate py-2 pr-3">{speaker.name}</td>
                    <td className="py-2 pr-3 text-right">
                      {formatDuration(speaker.talkSec)}
                    </td>
                    <td className="py-2 pr-3 text-right">{speaker.turns}</td>
                    <td className="py-2 pr-3 text-right">
                      {speaker.wordsPerMinute || "–"}
                    </td>
                    <td className="py-2 pr-3 text-right">{speaker.questions}</td>
                    <td className="py-2 text-right">
                      {formatDuration(speaker.longestMonologueSec)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {notes && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Coaching</h3>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                Overall tone: {SENTIMENT_LABELS[notes.coaching.sentiment]}
              </span>
            </div>
            {notes.coaching.highlights.length > 0 && (
              <NotesSection title="What went well">
                <BulletList items={notes.coaching.highlights} />
              </NotesSection>
            )}
            {notes.coaching.suggestions.length > 0 && (
              <NotesSection title="Try next time">
                <BulletList items={notes.coaching.suggestions} />
              </NotesSection>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
