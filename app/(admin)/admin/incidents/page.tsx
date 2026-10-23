"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { CheckCheck, Loader2 } from "lucide-react";
import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { ListSkeleton } from "@/components/list-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Filter = "open" | "resolved";

/**
 * Failures users hit that were hidden behind friendly copy (vendor errors,
 * missing keys, crashes). Same failure while open = one row with a counter.
 */
function IncidentList() {
  const [filter, setFilter] = useState<Filter>("open");
  const incidents = useQuery(api.incidents.list, { status: filter });
  const resolve = useMutation(api.incidents.resolve);
  const resolveAll = useMutation(api.incidents.resolveAll);
  const [busy, setBusy] = useState<Id<"incidents"> | "all" | null>(null);

  const run = async (target: Id<"incidents"> | "all") => {
    setBusy(target);
    try {
      if (target === "all") {
        const n = await resolveAll();
        toast.success(`Marked ${n} error${n === 1 ? "" : "s"} resolved.`);
      } else {
        await resolve({ id: target });
      }
    } catch {
      toast.error("Couldn't update — are you still an admin?");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
          </TabsList>
        </Tabs>
        {filter === "open" && incidents && incidents.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => run("all")} disabled={busy !== null}>
            {busy === "all" ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
            Resolve all
          </Button>
        )}
      </div>

      {incidents === undefined ? (
        <ListSkeleton rows={4} />
      ) : incidents === null ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Admin access required.
          </CardContent>
        </Card>
      ) : incidents.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {filter === "open" ? "No open errors — users aren't hitting anything." : "Nothing resolved yet."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {incidents.map((i) => (
              <div key={i._id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-primary/15 capitalize text-primary">{i.area}</Badge>
                    {i.vendor && <Badge variant="outline">{i.vendor}</Badge>}
                    {i.count > 1 && (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-400">
                        ×{i.count}
                      </Badge>
                    )}
                    <span className="font-mono text-xs text-muted-foreground">{i.source}</span>
                  </div>
                  <p className="break-words font-mono text-xs leading-relaxed">{i.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.userEmail ?? i.userName ?? "Unknown user"} · last seen{" "}
                    {new Date(i.lastAt).toLocaleString()}
                  </p>
                </div>
                {filter === "open" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => run(i._id)}
                    disabled={busy !== null}
                  >
                    {busy === i._id && <Loader2 className="size-4 animate-spin" />}
                    Resolve
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

export default function AdminIncidentsPage() {
  return (
    <LivePage>
      <PageHeader
        title="User Errors"
        description="Failures users hit. They saw a friendly message; the real cause is here. Every admin gets a bell notification when a new one appears."
      />
      <IncidentList />
    </LivePage>
  );
}
