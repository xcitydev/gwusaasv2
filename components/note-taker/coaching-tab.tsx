"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { ArrowDownUp, Gauge, HelpCircle, Megaphone, MessageCircleQuestion, Timer } from "lucide-react";
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
import {
  FILLER_TARGET_PER_MIN,
  PACE_TARGET,
  formatClock,
  formatDuration,
} from "@/lib/note-taker";
import { friendlyError, whenLabel } from "./shared";

type SortKey = "at" | "wpm" | "fillerPerMin" | "share" | "questions";

function Metric({
  icon: Icon,
  label,
  value,
  target,
  good,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  target: string;
  good: boolean | null;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </p>
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums",
            good === true && "text-emerald-400",
            good === false && "text-amber-400",
          )}
        >
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground">{target}</p>
      </CardContent>
    </Card>
  );
}

/** Your speaking habits across meetings — private to you. */
export function CoachingTab({
  onOpen,
}: {
  onOpen: (id: Id<"meetings">, atSec: number | null) => void;
}) {
  const [days, setDays] = useState("30");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "at", desc: true });
  const data = useQuery(api.noteTakerCoaching.coachingSummary, { days: Number(days) });
  const setSelf = useMutation(api.noteTakerCoaching.setSelfSpeaker);

  const rows = useMemo(() => {
    const list = [...(data?.meetings ?? [])];
    list.sort((a, b) => {
      const av = a[sort.key] ?? -1;
      const bv = b[sort.key] ?? -1;
      return sort.desc ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
    return list;
  }, [data, sort]);

  if (data === undefined) return <ListSkeleton rows={4} />;
  if (data === null) return null;
  const avg = data.averages;

  const header = (key: SortKey, label: string) => (
    <th className="py-2 pr-3 text-right font-medium">
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}
      >
        {label}
        <ArrowDownUp className={cn("size-3", sort.key !== key && "opacity-30")} />
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Your speaking habits across the meetings you ran — only you can see this.
        </p>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger size="sm" className="w-36" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {data.unidentified.length > 0 && (
        <Card className="border-primary/20">
          <CardContent className="space-y-3 p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <HelpCircle className="size-4 text-primary" /> Which speaker is you?
            </p>
            <p className="text-xs text-muted-foreground">
              Pick yourself once and we remember the name for future meetings.
            </p>
            <div className="space-y-2">
              {data.unidentified.map((meeting) => (
                <div key={meeting.meetingId} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {meeting.title}{" "}
                    <span className="text-muted-foreground">· {whenLabel(meeting.at)}</span>
                  </span>
                  <Select
                    onValueChange={async (name) => {
                      try {
                        await setSelf({ meetingId: meeting.meetingId, name });
                      } catch (e) {
                        toast.error(friendlyError(e, "Couldn't save that."));
                      }
                    }}
                  >
                    <SelectTrigger size="sm" className="w-44" aria-label={`You in ${meeting.title}`}>
                      <SelectValue placeholder="This is me…" />
                    </SelectTrigger>
                    <SelectContent>
                      {meeting.speakers.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!avg ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No meetings of yours in this period yet. Coaching fills in as the
            note taker records meetings you run.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              icon={Gauge}
              label="Talking pace"
              value={`${avg.wpm} wpm`}
              target={`Target ${PACE_TARGET.min}–${PACE_TARGET.max}`}
              good={avg.wpm >= PACE_TARGET.min && avg.wpm <= PACE_TARGET.max}
            />
            <Metric
              icon={Megaphone}
              label="Filler phrases"
              value={avg.fillerPerMin === null ? "–" : `${avg.fillerPerMin.toFixed(1)}/min`}
              target={`“You know”, “kind of”, “basically”… under ${FILLER_TARGET_PER_MIN}/min. Ums and uhs only count on uploads — call transcripts leave them out.`}
              good={avg.fillerPerMin === null ? null : avg.fillerPerMin <= FILLER_TARGET_PER_MIN}
            />
            <Metric
              icon={MessageCircleQuestion}
              label="Questions asked"
              value={avg.questionsPerMeeting.toFixed(1)}
              target="Per meeting — more questions, more listening"
              good={avg.questionsPerMeeting >= 3}
            />
            <Metric
              icon={Timer}
              label="Your talk share"
              value={`${Math.round(avg.share * 100)}%`}
              target={`Across ${formatDuration(avg.talkSec)} of you talking`}
              good={avg.share <= 0.6}
            />
          </div>

          {data.moments.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div>
                  <p className="text-sm font-medium">Moments to replay</p>
                  <p className="text-xs text-muted-foreground">
                    Where you rushed, dragged or leaned on filler phrases — click to hear it.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.moments.map((moment, index) => (
                    <button
                      key={index}
                      onClick={() => onOpen(moment.meetingId as Id<"meetings">, moment.atSec)}
                      className="flex max-w-xs items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left text-xs transition-colors hover:border-primary/40"
                    >
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                          moment.kind === "filler"
                            ? "bg-amber-500/15 text-amber-400"
                            : moment.kind === "fast"
                              ? "bg-red-500/15 text-red-400"
                              : "bg-sky-500/15 text-sky-400",
                        )}
                      >
                        {moment.kind === "filler" ? "Filler" : moment.kind === "fast" ? "Fast" : "Slow"}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {moment.title}
                        <span className="text-muted-foreground"> · {moment.detail}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-primary">
                        {formatClock(moment.atSec)}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="overflow-x-auto p-4">
              <p className="mb-2 text-sm font-medium">Meeting by meeting</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Meeting</th>
                    {header("at", "Date")}
                    {header("wpm", "WPM")}
                    {header("fillerPerMin", "Filler / min")}
                    {header("share", "Talk share")}
                    {header("questions", "Questions")}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {rows.map((row) => (
                    <tr
                      key={row.meetingId}
                      className="cursor-pointer border-b border-border/50 hover:bg-accent"
                      onClick={() => onOpen(row.meetingId, null)}
                    >
                      <td className="max-w-56 truncate py-2 pr-3">{row.title}</td>
                      <td className="py-2 pr-3 text-right text-muted-foreground">
                        {new Date(row.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </td>
                      <td className={cn("py-2 pr-3 text-right", row.paceOff && "text-amber-400")}>
                        {row.wpm || "–"}
                      </td>
                      <td className={cn("py-2 pr-3 text-right", row.fillerHigh && "text-amber-400")}>
                        {row.fillerPerMin === null ? "–" : row.fillerPerMin.toFixed(1)}
                      </td>
                      <td className="py-2 pr-3 text-right">{Math.round(row.share * 100)}%</td>
                      <td className="py-2 text-right">{row.questions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
