"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";

const n = (v: number) => v.toLocaleString("en-US");

function Meter({
  label,
  used,
  cap,
  hint,
}: {
  label: string;
  used: number;
  cap: number;
  hint?: string;
}) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const tone =
    pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium tabular-nums">
          {n(used)} <span className="text-muted-foreground">/ {n(cap)}</span>
        </p>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={used}
        aria-label={label}
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The workspace's share of the sending engine: contacts enrolled, emails
 * sent this month and connected inboxes against the plan's caps.
 */
export function OutreachUsageCard() {
  const usage = useQuery(api.outreachLimits.usage);
  if (!usage) return null;
  const resets = new Date(usage.resetsAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const nearCap =
    usage.contacts / Math.max(1, usage.caps.contacts) >= 0.8 ||
    usage.emailsThisMonth / Math.max(1, usage.caps.emails) >= 0.8;
  return (
    <Card className="mb-4" data-tour="outreach-usage">
      <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:gap-8">
        <Meter
          label="Contacts in outreach"
          used={usage.contacts}
          cap={usage.caps.contacts}
          hint="Archive a finished campaign to free contacts."
        />
        <Meter
          label="Emails this month"
          used={usage.emailsThisMonth}
          cap={usage.caps.emails}
          hint={
            usage.pausedForCap
              ? `Limit reached — campaigns paused until ${resets}.`
              : `Resets ${resets} · up to ${n(usage.maxDailyCap)} a day per campaign`
          }
        />
        <Meter label="Inboxes" used={usage.inboxes} cap={usage.caps.inboxes} />
        {nearCap && usage.plan !== "team" && (
          <p className="self-center text-xs text-muted-foreground sm:max-w-[160px]">
            Close to the limit.{" "}
            <Link href="/settings?tab=billing" className="text-primary underline-offset-2 hover:underline">
              Team sends three times as much.
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
