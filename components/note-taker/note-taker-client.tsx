"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConnectCalendarCard } from "./connect-calendar-card";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { hasConvex } from "@/lib/runtime";
import {
  Loader2,
  NotebookPen,
  Search,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListSkeleton } from "@/components/list-skeleton";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Compass } from "lucide-react";
import { TourLauncher } from "@/components/tour/tour";
import { NOTE_TAKER_TOUR } from "@/components/tour/tours";
import { AgendaCoach } from "./agenda-coach";
import { AskPanel } from "./ask-panel";
import { IncompleteTab } from "./incomplete-tab";
import { UploadDialog } from "./upload-dialog";
import { CircleAlert, Gauge, Sparkles } from "lucide-react";
import { CoachingTab } from "./coaching-tab";
import { MeetingDetail } from "./meeting-detail";
import { MeetingBrowser, SearchResults } from "./meeting-list";
import { NoteTakerSettings } from "./note-taker-settings";
import { RecordDialog } from "./record-dialog";
import { UpcomingEvents } from "./upcoming-events";
import {
  MinutesMeter,
  StatusBadge,
  friendlyError,
  platformLabel,
  whenLabel,
  type MeetingRow,
  type Overview,
} from "./shared";

type OpenMeeting = { id: Id<"meetings">; atSec: number | null };

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type NoteTakerProps = {
  /** ?meeting=<id> — open this meeting (deep links from Ask / emails). */
  initialMeeting: string | null;
  /** ?t=<sec> — and jump to this moment. */
  initialAt: number | null;
  /** ?tab=meetings|ask|coaching|incomplete|coach */
  initialTab: string | null;
  /** ?connect=1 — from onboarding: point at the calendar card. */
  highlightConnect: boolean;
};

const TABS = ["meetings", "ask", "coaching", "incomplete", "coach"] as const;
type TabKey = (typeof TABS)[number];

/** Setup mode (no Convex provider): meeting capture needs Convex. */
export function NoteTakerClient(props: NoteTakerProps) {
  if (!hasConvex) {
    return (
      <Card className="border-white/10">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <NotebookPen className="size-8 text-muted-foreground" />
          <p className="font-medium">AI Note Taker</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Meeting capture and notes need Convex — preview-only until it is connected.
          </p>
        </CardContent>
      </Card>
    );
  }
  return <NoteTakerLive {...props} />;
}

function NoteTakerLive({
  initialMeeting,
  initialAt,
  initialTab,
  highlightConnect,
}: NoteTakerProps) {
  const router = useRouter();
  const overview = useQuery(api.noteTaker.overview);
  const incomplete = useQuery(api.noteTaker.listIncomplete);
  const linked = useQuery(
    api.noteTaker.resolveMeetingId,
    initialMeeting ? { id: initialMeeting } : "skip",
  );
  const [open, setOpenState] = useState<OpenMeeting | null>(null);
  const [tab, setTab] = useState<TabKey>(
    TABS.includes(initialTab as TabKey) ? (initialTab as TabKey) : "meetings",
  );

  // A deep link (?meeting=…&t=…) opens that meeting — also when the URL
  // changes while this page is already mounted (citation click in the Ask bar).
  const linkKey = `${linked ?? ""}:${initialAt ?? ""}`;
  const [seenLink, setSeenLink] = useState("");
  if (linked && linkKey !== seenLink) {
    setSeenLink(linkKey);
    setOpenState({ id: linked, atSec: initialAt });
  }

  const setOpen = (next: OpenMeeting | null) => {
    setOpenState(next);
    // Drop the deep link so Back really goes back to the list.
    if (!next && initialMeeting) router.replace("/note-taker", { scroll: false });
  };

  if (open) {
    return (
      <MeetingDetail
        meetingId={open.id}
        focusSec={open.atSec}
        onBack={() => setOpen(null)}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="AI Note Taker"
        description="Automatically records, transcribes, and summarizes conversations across Zoom, Google Meet, Microsoft Teams"
        actions={
          overview ? (
            <>
              <TourLauncher tour={NOTE_TAKER_TOUR} />
              <NoteTakerSettings overview={overview} />
              <UploadDialog
                overview={overview}
                onUploaded={(id) => setOpen({ id, atSec: null })}
              />
              <RecordDialog
                overview={overview}
                onSent={(id) => setOpen({ id, atSec: null })}
              />
            </>
          ) : null
        }
      />
      {overview === undefined ? (
        <ListSkeleton rows={4} />
      ) : overview === null ? null : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
          <TabsList className="mb-4">
            <TabsTrigger value="meetings" className="gap-1.5">
              <NotebookPen className="size-4" /> Meetings
            </TabsTrigger>
            <TabsTrigger value="ask" className="gap-1.5">
              <Sparkles className="size-4" /> Ask
            </TabsTrigger>
            <TabsTrigger value="coaching" className="gap-1.5">
              <Gauge className="size-4" /> Coaching
            </TabsTrigger>
            <TabsTrigger value="incomplete" className="gap-1.5">
              <CircleAlert className="size-4" /> Incomplete
              {incomplete && incomplete.recentCount > 0 && (
                <span className="rounded-full bg-destructive/20 px-1.5 text-[10px] font-semibold text-destructive">
                  {incomplete.recentCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="coach" className="gap-1.5" data-tour="notetaker-tab-coach">
              <Compass className="size-4" /> Agenda Coach
            </TabsTrigger>
          </TabsList>
          <TabsContent value="ask">
            <AskPanel />
          </TabsContent>
          <TabsContent value="coaching">
            <CoachingTab onOpen={(id, atSec) => setOpen({ id, atSec })} />
          </TabsContent>
          <TabsContent value="incomplete">
            <IncompleteTab onOpen={(id) => setOpen({ id, atSec: null })} />
          </TabsContent>
          <TabsContent value="meetings">
            <Home
              overview={overview}
              onOpen={setOpen}
              highlightConnect={highlightConnect}
            />
          </TabsContent>
          <TabsContent value="coach">
            <AgendaCoach overview={overview} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function Home({
  overview,
  onOpen,
  highlightConnect,
}: {
  overview: Overview;
  onOpen: (open: OpenMeeting) => void;
  highlightConnect: boolean;
}) {
  const calendarConnected = overview.calendars.some((c) => c.status === "connected");
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim(), 300);
  const searching = term.length >= 2;

  return (
    <div className="space-y-4">
      {!overview.configured && (
        <Banner>
          {overview.isAdmin ? (
            <>
              <span className="font-medium text-foreground">Admin:</span> the
              note taker needs a Recall.ai key. Run{" "}
              <code className="text-primary">npx convex env set RECALL_API_KEY …</code>{" "}
              and <code className="text-primary">RECALL_REGION</code> (the region
              the key was created in, e.g. us-west-2).
            </>
          ) : (
            "The note taker isn't switched on for the platform yet — check back soon."
          )}
        </Banner>
      )}
      {overview.configured && overview.credits < overview.minCredits && (
        <Banner>
          You need at least {overview.minCredits} credits to record a meeting
          ({overview.creditsPerMinute} per minute) — calendar auto-join is paused
          until you top up.
        </Banner>
      )}
      {overview.configured && overview.credits >= overview.minCredits && (
        <MinutesMeter overview={overview} compact />
      )}

      <LiveStrip onOpen={(id) => onOpen({ id, atSec: null })} />

      {calendarConnected ? (
        <UpcomingEvents autoJoin={overview.settings.autoJoin} />
      ) : (
        overview.configured && (
          <ConnectCalendarCard overview={overview} highlight={highlightConnect} />
        )
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search every meeting — titles, notes, and what was said…"
          className="pl-8 pr-8"
          aria-label="Search meetings"
          data-tour="notetaker-search"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {searching ? (
        <SearchResults term={term} onOpen={(id, atSec) => onOpen({ id, atSec })} />
      ) : (
        <MeetingBrowser
          configured={overview.configured}
          onOpen={(id) => onOpen({ id, atSec: null })}
        />
      )}
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-muted-foreground">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
      <p>{children}</p>
    </div>
  );
}

/** Bots in flight and what is scheduled next — live, with a Stop button. */
function LiveStrip({ onOpen }: { onOpen: (id: Id<"meetings">) => void }) {
  const live = useQuery(api.noteTaker.liveMeetings) ?? [];
  const stop = useAction(api.noteTakerActions.stopMeeting);
  const [stopping, setStopping] = useState<Id<"meetings"> | null>(null);
  if (live.length === 0) return null;

  const doStop = async (meeting: MeetingRow) => {
    setStopping(meeting._id);
    try {
      await stop({ meetingId: meeting._id });
      toast.success(
        meeting.status === "scheduled"
          ? "Skipped — no bot will join."
          : "The note taker is leaving; notes follow for what it heard.",
      );
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't stop the note taker."));
    } finally {
      setStopping(null);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardContent className="divide-y divide-border p-0">
        {live.map((meeting) => (
          <div key={meeting._id} className="flex items-center gap-3 px-4 py-3">
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => onOpen(meeting._id)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium">{meeting.title}</p>
                <StatusBadge status={meeting.status} />
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {platformLabel(meeting.platform)}
                {meeting.status === "scheduled" && meeting.scheduledFor
                  ? ` · ${whenLabel(meeting.scheduledFor)}`
                  : ""}
                {meeting.statusDetail ? ` · ${meeting.statusDetail}` : ""}
              </p>
            </button>
            {meeting.status !== "processing" && (
              <Button
                variant="outline"
                size="sm"
                disabled={stopping !== null}
                onClick={() => void doStop(meeting)}
              >
                {stopping === meeting._id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Square className="size-3.5" />
                )}
                {meeting.status === "scheduled" ? "Skip" : "Stop"}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
