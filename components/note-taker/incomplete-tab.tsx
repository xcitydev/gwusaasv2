"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { CircleCheck, Coins, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListSkeleton } from "@/components/list-skeleton";
import { FAILURE_CODES, detectPlatform } from "@/lib/note-taker";
import { openTopUp } from "@/lib/top-up-prompt";
import { StatusBadge, friendlyError, platformLabel, whenLabel, type MeetingRow } from "./shared";

/**
 * Meetings the bot didn't record — each with the reason and the fix
 * (Read.ai's "Incomplete" reports, with a one-click way out).
 */
export function IncompleteTab({ onOpen }: { onOpen: (id: Id<"meetings">) => void }) {
  const data = useQuery(api.noteTaker.listIncomplete);
  const sendBot = useAction(api.noteTakerActions.sendBot);
  const [busy, setBusy] = useState<Id<"meetings"> | null>(null);

  if (data === undefined) return <ListSkeleton rows={3} />;
  if (data.meetings.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <CircleCheck className="size-7 text-emerald-400" />
          <p className="font-medium">Nothing missed</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            When the bot can&apos;t record a meeting — not admitted, bad link,
            out of credits — it shows up here with how to fix it.
          </p>
        </CardContent>
      </Card>
    );
  }

  const retry = async (meeting: MeetingRow) => {
    setBusy(meeting._id);
    try {
      const { meetingId } = await sendBot({ meetingUrl: meeting.meetingUrl, title: meeting.title });
      toast.success("The note taker is on its way.");
      onOpen(meetingId);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't send the note taker."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardContent className="divide-y divide-border p-0">
        {data.meetings.map((meeting) => {
          const reason = FAILURE_CODES[meeting.failureCode ?? ""] ?? null;
          const canRetry =
            reason?.action === "retry" && Boolean(detectPlatform(meeting.meetingUrl));
          return (
            <div key={meeting._id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <button className="min-w-0 flex-1 space-y-1 text-left" onClick={() => onOpen(meeting._id)}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{meeting.title}</p>
                  <StatusBadge status={meeting.status} />
                  <span className="ml-auto text-xs text-muted-foreground">
                    {whenLabel(meeting.scheduledFor ?? meeting._creationTime)}
                  </span>
                </div>
                <p className="text-xs">
                  <span className="font-medium text-foreground">
                    {reason?.title ?? "Didn't record"}
                  </span>
                  <span className="text-muted-foreground">
                    {" — "}
                    {reason?.fix ?? meeting.statusDetail ?? "The bot couldn't record this meeting."}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground">{platformLabel(meeting.platform)}</p>
              </button>
              <div className="flex shrink-0 gap-2">
                {canRetry && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void retry(meeting)}
                  >
                    {busy === meeting._id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RotateCcw className="size-4" />
                    )}
                    Send again
                  </Button>
                )}
                {reason?.action === "topup" && (
                  <Button variant="outline" size="sm" onClick={() => openTopUp({ context: "Note taker" })}>
                    <Coins className="size-4" /> Top up
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
