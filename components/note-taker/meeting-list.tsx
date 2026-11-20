"use client";

import { useMemo, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  FolderPlus,
  ListChecks,
  Loader2,
  NotebookPen,
  Pencil,
  Trash2,
  Users,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListSkeleton } from "@/components/list-skeleton";
import { cn } from "@/lib/utils";
import { formatClock, formatDuration } from "@/lib/note-taker";
import { MEETING_TEMPLATES, isMeetingType } from "@/lib/meeting-templates";
import { FolderDialog, type FolderInput } from "./folder-dialog";
import {
  FolderChip,
  ScoreChip,
  StatusBadge,
  TypeChip,
  friendlyError,
  platformLabel,
  weekLabel,
  weekStart,
  whenLabel,
  type MeetingRow,
} from "./shared";

const PAGE_SIZE = 20;

type FolderMap = Map<string, { name: string; color: string | null }>;

/** Which slice of the list is showing: everything, a smart folder, or a folder. */
type Slice =
  | { kind: "all" }
  | { kind: "type"; type: string }
  | { kind: "folder"; folderId: Id<"noteFolders"> };

const SOURCES = {
  any: "Any source",
  calendar: "Calendar",
  manual: "Pasted link",
  calcom: "Cal.com",
  upload: "Upload",
} as const;

const RANGES = {
  any: "Anytime",
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
} as const;

function meetingTime(meeting: MeetingRow): number {
  return meeting.startedAt ?? meeting.scheduledFor ?? meeting._creationTime;
}

export function MeetingRowButton({
  meeting,
  folders,
  snippet,
  atSec,
  onOpen,
}: {
  meeting: MeetingRow;
  folders?: FolderMap;
  snippet?: string | null;
  atSec?: number | null;
  onOpen: () => void;
}) {
  const remove = useMutation(api.noteTaker.deleteMeeting);
  const people = meeting.attendees?.length ?? 0;
  const folderChips = (meeting.folderIds ?? []).flatMap((id) => {
    const folder = folders?.get(id);
    return folder ? [{ id, ...folder }] : [];
  });
  return (
    <div className="flex items-center gap-2 pr-3 transition-colors hover:bg-accent">
      <button onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-1 px-4 py-3 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <ScoreChip score={meeting.score} />
          <p className="min-w-0 truncate text-sm font-medium">{meeting.title}</p>
          {meeting.status !== "done" && <StatusBadge status={meeting.status} />}
          <TypeChip type={meeting.meetingType} />
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {whenLabel(meetingTime(meeting))}
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
          <p className="line-clamp-2 text-xs text-muted-foreground">{meeting.summary}</p>
        ) : meeting.statusDetail ? (
          <p className="text-xs text-muted-foreground">{meeting.statusDetail}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            {meeting.source === "upload" ? "Upload" : platformLabel(meeting.platform)}
          </span>
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
          {folderChips.map((folder) => (
            <FolderChip key={folder.id} name={folder.name} color={folder.color} />
          ))}
        </div>
      </button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Delete “${meeting.title}”`}
          >
            <Trash2 className="size-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{meeting.title}”?</AlertDialogTitle>
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

/** Folder map (id → name/colour) for the row chips. */
export function useFolderMap(): FolderMap {
  const summary = useQuery(api.noteTaker.folderSummary);
  return useMemo(
    () => new Map((summary?.folders ?? []).map((f) => [f._id as string, f])),
    [summary],
  );
}

/** Smart folders + custom folders + filters + the week-grouped list. */
export function MeetingBrowser({
  configured,
  onOpen,
}: {
  configured: boolean;
  onOpen: (id: Id<"meetings">) => void;
}) {
  const summary = useQuery(api.noteTaker.folderSummary);
  const [slice, setSlice] = useState<Slice>({ kind: "all" });
  const [source, setSource] = useState<keyof typeof SOURCES>("any");
  // The cutoff is fixed when the range is picked, so the paginated query
  // keeps stable arguments between renders.
  const [{ range, since }, setRangeState] = useState<{
    range: keyof typeof RANGES;
    since: number | undefined;
  }>({ range: "any", since: undefined });
  const setRange = (next: keyof typeof RANGES) =>
    setRangeState({
      range: next,
      since: next === "any" ? undefined : Date.now() - Number(next) * 24 * 60 * 60_000,
    });
  const [dialog, setDialog] = useState<{ open: boolean; folder: FolderInput | null }>({
    open: false,
    folder: null,
  });
  const folderMap = useMemo(
    () => new Map((summary?.folders ?? []).map((f) => [f._id as string, f])),
    [summary],
  );

  const chip = (active: boolean) =>
    cn(
      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
      active
        ? "border-primary/60 bg-primary/10 text-foreground"
        : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
          <button className={chip(slice.kind === "all")} onClick={() => setSlice({ kind: "all" })}>
            All meetings
          </button>
          {(summary?.types ?? []).map(({ type, count }) =>
            isMeetingType(type) && type !== "general" ? (
              <button
                key={type}
                className={chip(slice.kind === "type" && slice.type === type)}
                onClick={() => setSlice({ kind: "type", type })}
                title={MEETING_TEMPLATES[type].description}
              >
                {MEETING_TEMPLATES[type].label}
                <span className="text-muted-foreground">{count}</span>
              </button>
            ) : null,
          )}
          {(summary?.folders ?? []).map((folder) => {
            const active = slice.kind === "folder" && slice.folderId === folder._id;
            return (
              <span key={folder._id} className={cn(chip(active), "pr-1.5")}>
                <button
                  className="inline-flex items-center gap-1.5"
                  onClick={() => setSlice({ kind: "folder", folderId: folder._id })}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ background: folder.color ?? "currentColor" }}
                  />
                  {folder.name}
                  <span className="text-muted-foreground">{folder.count}</span>
                </button>
                <button
                  aria-label={`Edit ${folder.name}`}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setDialog({ open: true, folder })}
                >
                  <Pencil className="size-3" />
                </button>
              </span>
            );
          })}
          <button
            className={chip(false)}
            onClick={() => setDialog({ open: true, folder: null })}
          >
            <FolderPlus className="size-3.5" /> New folder
          </button>
        </div>
        <div className="flex gap-2">
          <Select value={source} onValueChange={(v) => setSource(v as keyof typeof SOURCES)}>
            <SelectTrigger size="sm" className="w-[130px]" aria-label="Source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SOURCES).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={(v) => setRange(v as keyof typeof RANGES)}>
            <SelectTrigger size="sm" className="w-[130px]" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(RANGES).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <GroupedList
        key={JSON.stringify([slice, source, since])}
        args={{
          ...(slice.kind === "type" && { meetingType: slice.type }),
          ...(slice.kind === "folder" && { folderId: slice.folderId }),
          ...(source !== "any" && { source }),
          ...(since !== undefined && { since }),
        }}
        filtered={slice.kind !== "all" || source !== "any" || range !== "any"}
        configured={configured}
        folders={folderMap}
        onOpen={onOpen}
      />

      <FolderDialog
        open={dialog.open}
        folder={dialog.folder}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  );
}

function GroupedList({
  args,
  filtered,
  configured,
  folders,
  onOpen,
}: {
  args: {
    meetingType?: string;
    folderId?: Id<"noteFolders">;
    source?: "manual" | "calendar" | "calcom" | "upload";
    since?: number;
  };
  filtered: boolean;
  configured: boolean;
  folders: FolderMap;
  onOpen: (id: Id<"meetings">) => void;
}) {
  const { results, status, loadMore } = usePaginatedQuery(api.noteTaker.listMeetings, args, {
    initialNumItems: PAGE_SIZE,
  });

  const groups = useMemo(() => {
    const byWeek = new Map<number, MeetingRow[]>();
    for (const meeting of results) {
      const week = weekStart(meetingTime(meeting));
      byWeek.set(week, [...(byWeek.get(week) ?? []), meeting]);
    }
    return [...byWeek.entries()].sort((a, b) => b[0] - a[0]);
  }, [results]);

  if (status === "LoadingFirstPage") return <ListSkeleton rows={4} />;
  if (results.length === 0 && status === "Exhausted") {
    if (filtered) {
      return (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No meetings match these filters.
        </p>
      );
    }
    return (
      <Card className="border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 text-primary">
            <NotebookPen className="size-6" />
          </span>
          <p className="font-medium">Never take meeting notes again</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {configured
              ? "Connect your calendar so the note taker joins on its own, or press “Record a meeting” and paste a link. Minutes after the call you get the summary, decisions, action items and a searchable transcript."
              : "Once the note taker is switched on, paste any meeting link and it joins, records and writes the notes for you."}
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        {groups.map(([week, meetings]) => (
          <section key={week}>
            <p className="sticky top-0 z-[1] border-b border-border bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
              {weekLabel(week)}
            </p>
            <div className="divide-y divide-border">
              {meetings.map((meeting) => (
                <MeetingRowButton
                  key={meeting._id}
                  meeting={meeting}
                  folders={folders}
                  onOpen={() => onOpen(meeting._id)}
                />
              ))}
            </div>
          </section>
        ))}
        {status === "CanLoadMore" && (
          <div className="border-t border-border p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => loadMore(PAGE_SIZE)}>
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

export function SearchResults({
  term,
  onOpen,
}: {
  term: string;
  onOpen: (id: Id<"meetings">, atSec: number | null) => void;
}) {
  const results = useQuery(api.noteTaker.searchMeetings, { q: term });
  const folders = useFolderMap();
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
                folders={folders}
                snippet={snippet}
                atSec={atSec}
                onOpen={() => onOpen(meeting._id, atSec)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
