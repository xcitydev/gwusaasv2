"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MeetingBrief } from "@/lib/note-taker";
import { friendlyError, whenLabel } from "./shared";

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="list-disc space-y-0.5 pl-4 text-sm">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The pre-meeting brief: who's coming, our history with them, open
 * promises, a suggested agenda — from this workspace's own leads,
 * outreach, past meetings and DMs.
 */
export function BriefCard({ meeting }: { meeting: Doc<"meetings"> }) {
  const prepare = useAction(api.noteTakerBrief.prepareNow);
  const [busy, setBusy] = useState(false);
  const brief = (meeting.brief ?? null) as MeetingBrief | null;
  const upcoming = meeting.status === "scheduled";

  // After the meeting a brief is only worth showing if one was written.
  if (!upcoming && brief?.status !== "ready") return null;

  const run = async () => {
    setBusy(true);
    try {
      const result = await prepare({ meetingId: meeting._id });
      if (result.status !== "ready" && result.reason) toast.error(result.reason);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't prepare the brief."));
    } finally {
      setBusy(false);
    }
  };

  const sources = brief?.sources;
  const sourceLine = sources
    ? [
        sources.leads && `${sources.leads} lead record${sources.leads === 1 ? "" : "s"}`,
        sources.replies && `${sources.replies} email repl${sources.replies === 1 ? "y" : "ies"}`,
        sources.meetings && `${sources.meetings} past meeting${sources.meetings === 1 ? "" : "s"}`,
        sources.dms && `${sources.dms} possible DM thread${sources.dms === 1 ? "" : "s"}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <Card className="border-primary/20">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <ClipboardList className="size-4 text-primary" /> Pre-meeting brief
            </p>
            <p className="text-xs text-muted-foreground">
              {brief?.status === "ready"
                ? `Prepared ${whenLabel(brief.generatedAt)}${sourceLine ? ` from ${sourceLine}` : " — no history with these guests yet"}`
                : "Who's coming, your history with them, and what's still open — from your leads, outreach and past meetings."}
            </p>
          </div>
          {upcoming && (
            <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : brief?.status === "ready" ? (
                <RefreshCw className="size-4" />
              ) : (
                <ClipboardList className="size-4" />
              )}
              {brief?.status === "ready" ? "Refresh" : "Prepare now"}
            </Button>
          )}
        </div>

        {brief && brief.status !== "ready" && brief.reason && (
          <p className="rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
            {brief.reason}
          </p>
        )}

        {brief?.status === "ready" && (
          <div className="space-y-4">
            {brief.headline && <p className="text-sm leading-relaxed">{brief.headline}</p>}
            {(brief.people ?? []).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Who&apos;s coming
                </p>
                {(brief.people ?? []).map((person, i) => (
                  <div key={i} className="rounded-lg border border-border px-3 py-2">
                    <p className="text-sm">
                      <span className="font-medium">{person.name}</span>
                      <span className="text-muted-foreground"> — {person.who}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{person.history}</p>
                    {person.openItems.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-xs">
                        {person.openItems.map((item, j) => (
                          <li key={j}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            <List title="Open promises" items={brief.openPromises} />
            <List title="Suggested agenda" items={brief.suggestedAgenda} />
            <List title="Questions to ask" items={brief.questionsToAsk} />
            <List title="Watch out for" items={brief.watchOuts} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
