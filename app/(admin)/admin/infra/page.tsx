"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ServerCog } from "lucide-react";
import { LivePage } from "@/components/live-page";
import { ModulePlaceholder } from "@/components/module-placeholder";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const n = (v: number) => v.toLocaleString("en-US");

function PoolMeter({ label, used, cap }: { label: string; used: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const tone = pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm">{label}</p>
        <p className="font-mono text-sm tabular-nums">
          {n(used)} <span className="text-muted-foreground">/ {n(cap)}</span>{" "}
          <span className={pct >= 80 ? "text-amber-500" : "text-muted-foreground"}>({pct}%)</span>
        </p>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used} aria-label={label}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * The shared Instantly pool: every workspace's enrolled contacts and this
 * month's sends against the plan the platform pays for. Admins get a
 * notification once a month past 80%; enrolment and activation stop at 100%.
 */
function InstantlyPool() {
  const pool = useQuery(api.outreachLimits.platformPool);
  if (pool === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (pool === null) return null;
  const resets = new Date(pool.resetsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sending engine pool (Instantly)</CardTitle>
        <p className="text-xs text-muted-foreground">
          Month {pool.month} · email counter resets {resets} · limits are set in Admin → Config.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <PoolMeter label="Uploaded contacts (all workspaces)" used={pool.contacts} cap={pool.contactsCap} />
        <PoolMeter label="Emails sent this month (all workspaces)" used={pool.emails} cap={pool.emailsCap} />
        {pool.topWorkspaces.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Largest consumers</p>
            <div className="divide-y divide-border">
              {pool.topWorkspaces.map((w) => (
                <div key={w.workspaceId} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <p className="min-w-0 truncate">
                    {w.name} <span className="text-muted-foreground">· {w.plan}</span>
                  </p>
                  <p className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {n(w.contacts)} contacts · {n(w.emailsThisMonth)} emails
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminInfraPage() {
  return (
    <LivePage>
      <PageHeader
        title="Infrastructure"
        description="Technical view for dev admins — service health and shared capacity."
      />
      <div className="flex flex-col gap-6">
        <InstantlyPool />
        <ModulePlaceholder
          icon={ServerCog}
          title="More service health"
          description="Other integrations will report here as they get health checks."
          phase="Grows with each phase"
          features={[
            "Lead source health (scrapers, providers)",
            "Voice services (Bland AI)",
            "Domain registrations (Porkbun)",
            "Webhook and API logs",
          ]}
        />
      </div>
    </LivePage>
  );
}
