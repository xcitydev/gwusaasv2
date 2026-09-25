"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { CalendarClock, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { friendlyError, platformLabel, whenLabel } from "./shared";

type UpcomingEvent = FunctionReturnType<
  typeof api.noteTakerActions.listUpcomingEvents
>[number];

/** The next two weeks from connected calendars, with a Record toggle each. */
export function UpcomingEvents({ autoJoin }: { autoJoin: "all" | "manual" }) {
  const listUpcoming = useAction(api.noteTakerActions.listUpcomingEvents);
  const setRecording = useAction(api.noteTakerActions.setEventRecording);
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listUpcoming({})
      .then(setEvents)
      .catch((e) => toast.error(friendlyError(e, "Couldn't load your calendar.")))
      .finally(() => setLoading(false));
  }, [listUpcoming]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const toggle = async (event: UpcomingEvent, record: boolean) => {
    setBusyId(event.eventId);
    try {
      await setRecording({
        calendarDocId: event.calendarDocId,
        eventId: event.eventId,
        record,
      });
      setEvents(
        (current) =>
          current?.map((e) =>
            e.eventId === event.eventId ? { ...e, recording: record } : e,
          ) ?? null,
      );
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't update that event."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" />
            <p className="text-sm font-medium">Upcoming from your calendar</p>
            <span className="text-xs text-muted-foreground">
              {autoJoin === "all"
                ? "Auto-recording everything with a link"
                : "Pick what to record"}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
        {events === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : events.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing on the calendar for the next two weeks.
          </p>
        ) : (
          <div className="max-h-72 divide-y divide-border overflow-y-auto">
            {events.map((event) => (
              <div
                key={`${event.calendarDocId}-${event.eventId}`}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{event.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {whenLabel(event.startsAt)}
                    {" · "}
                    {event.meetingUrl
                      ? platformLabel(event.platform)
                      : "No meeting link"}
                    {event.attendeeCount > 0 &&
                      ` · ${event.attendeeCount} invited`}
                  </p>
                </div>
                {busyId === event.eventId && (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                )}
                <Switch
                  checked={event.recording}
                  disabled={!event.meetingUrl || busyId !== null}
                  onCheckedChange={(checked) => void toggle(event, checked)}
                  aria-label={`Record ${event.title}`}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
