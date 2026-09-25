"use client";

import { useEffect, useState } from "react";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  ListChecks,
  Loader2,
  NotebookPen,
  Search,
  Square,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListSkeleton } from "@/components/list-skeleton";
import { PageHeader } from "@/components/page-header";
import { formatClock, formatDuration } from "@/lib/note-taker";
import { MeetingDetail } from "./meeting-detail";
import { NoteTakerSettings } from "./note-taker-settings";
import { RecordDialog } from "./record-dialog";
import { UpcomingEvents } from "./upcoming-events";
import {
  StatusBadge,
  friendlyError,
  platformLabel,
  whenLabel,
  type MeetingRow,
  type Overview,
} from "./shared";

const PAGE_SIZE = 20;

type OpenMeeting = { id: Id<"meetings">; atSec: number | null };

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function NoteTakerClient() {
  const overview = useQuery(api.noteTaker.overview);
  const [open, setOpen] = useState<OpenMeeting | null>(null);

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
              <NoteTakerSettings overview={overview} />
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
        <Home overview={overview} onOpen={setOpen} />
      )}
    </div>
  );
}

function Home({
  overview,
  onOpen,
}: {
  overview: Overview;
  onOpen: (open: OpenMeeting) => void;
}) {
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

      <LiveStrip onOpen={(id) => onOpen({ id, atSec: null })} />

      {overview.calendars.some((c) => c.status === "connected") && (
        <UpcomingEvents autoJoin={overview.settings.autoJoin} />
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search every meeting — titles, notes, and what was said…"
          className="pl-8 pr-8"
          aria-label="Search meetings"
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
        <SearchResults term={term} onOpen={onOpen} />
      ) : (
        <MeetingList
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

function MeetingRowButton({
  meeting,
  snippet,
  atSec,
  onOpen,
}: {
  meeting: MeetingRow;
  snippet?: string | null;
  atSec?: number | null;
  onOpen: () => void;
}) {
  const people = meeting.attendees?.length ?? 0;
  return (
    <button
      onClick={onOpen}
      className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-accent"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{meeting.title}</p>
        {meeting.status !== "done" && <StatusBadge status={meeting.status} />}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {whenLabel(meeting.startedAt ?? meeting.scheduledFor ?? meeting._creationTime)}
        </span>
      </div>
      {snippet ? (
        <p className="line-clamp-2 text-xs text-foreground/80">
          {atSec !== null && atSec !== undefined && (
            <span className="mr-1.5 rounded bg-primary/15 px-1 py-0.5 font-mono text-[10px] text-primary">
              {formatClock(atSec)}
            </span>
          )}
          {snippet}
        </p>
      ) : meeting.summary ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {meeting.summary}
        </p>
      ) : meeting.statusDetail ? (
        <p className="text-xs text-muted-foreground">{meeting.statusDetail}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{platformLabel(meeting.platform)}</span>
        {meeting.durationSec ? <span>{formatDuration(meeting.durationSec)}</span> : null}
        {people > 0 && (
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" /> {people}
          </span>
        )}
        {meeting.actionItemCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <ListChecks className="size-3" /> {meeting.actionItemCount} action
            {meeting.actionItemCount === 1 ? " item" : " items"}
          </span>
        )}
      </div>
    </button>
  );
}

function MeetingList({
  configured,
  onOpen,
}: {
  configured: boolean;
  onOpen: (id: Id<"meetings">) => void;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.noteTaker.listMeetings,
    {},
    { initialNumItems: PAGE_SIZE },
  );
  if (status === "LoadingFirstPage") return <ListSkeleton rows={4} />;
  if (results.length === 0) {
    return (
      <Card className="border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 text-primary">
            <NotebookPen className="size-6" />
          </span>
          <p className="font-medium">Never take meeting notes again</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {configured
              ? "Press “Record a meeting”, paste the invite link, and the note taker joins. Minutes after the call you get the summary, decisions, action items and a searchable transcript."
              : "Once the note taker is switched on, paste any meeting link and it joins, records and writes the notes for you."}
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="divide-y divide-border p-0">
        {results.map((meeting) => (
          <MeetingRowButton
            key={meeting._id}
            meeting={meeting}
            onOpen={() => onOpen(meeting._id)}
          />
        ))}
        {status === "CanLoadMore" && (
          <div className="p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => loadMore(PAGE_SIZE)}
            >
              Load {PAGE_SIZE} more
            </Button>
          </div>
        )}
        {status === "LoadingMore" && (
          <div className="flex justify-center p-2">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SearchResults({
  term,
  onOpen,
}: {
  term: string;
  onOpen: (open: OpenMeeting) => void;
}) {
  const results = useQuery(api.noteTaker.searchMeetings, { q: term });
  if (results === undefined) return <ListSkeleton rows={3} />;
  return (
    <Card>
      <CardContent className="p-0">
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          {results.length} meeting{results.length === 1 ? "" : "s"} matching “{term}”
        </p>
        {results.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing in any title, note or transcript matches.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {results.map(({ meeting, snippet, atSec }) => (
              <MeetingRowButton
                key={meeting._id}
                meeting={meeting}
                snippet={snippet}
                atSec={atSec}
                onOpen={() => onOpen({ id: meeting._id, atSec })}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
