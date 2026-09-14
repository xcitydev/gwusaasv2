"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Eye, FileText, Loader2 } from "lucide-react";
import { getFormDef } from "@/lib/forms-def";
import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Filter = "processing" | "active" | "closed" | "all";

function SubmissionDetail({
  id,
  onDone,
}: {
  id: Id<"formSubmissions">;
  onDone: () => void;
}) {
  const submission = useQuery(api.forms.adminGet, { id });
  const setStatus = useMutation(api.forms.setStatus);
  const reveal = useAction(api.forms.revealSensitive);
  const [revealed, setRevealed] = useState<Record<string, string> | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [confirmActive, setConfirmActive] = useState(false);

  if (submission === undefined) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!submission) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Not found.</p>;
  }

  const def = getFormDef(submission.formSlug);
  const hasSensitive = def?.fields.some((f) => f.sensitive) ?? false;

  const doReveal = async () => {
    setRevealing(true);
    try {
      setRevealed(await reveal({ id }));
    } catch {
      toast.error("Reveal failed — superadmin only.");
    } finally {
      setRevealing(false);
    }
  };

  const markActive = async () => {
    try {
      await setStatus({ id, status: "active" });
      toast.success("Marked active — the user has been notified.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update.");
    }
    setConfirmActive(false);
  };

  const displayValue = (fieldName: string, raw: unknown): string => {
    if (revealed && fieldName in revealed) return revealed[fieldName];
    if (typeof raw === "boolean") return raw ? "Yes" : "No";
    if (raw === undefined || raw === null || raw === "") return "—";
    return String(raw);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {submission.userName ?? submission.userEmail} ·{" "}
            {new Date(submission._creationTime).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={submission.status} />
      </div>

      <ScrollArea className="max-h-[50dvh] pr-3">
        <dl className="space-y-4">
          {def?.fields
            .filter((f) => f.type !== "file")
            .map((f) => (
              <div key={f.name}>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {f.label}
                  {f.sensitive && <span className="ml-1 text-primary">(sensitive)</span>}
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm">
                  {displayValue(
                    f.name,
                    (submission.data as Record<string, unknown>)[f.name],
                  )}
                </dd>
              </div>
            ))}
          {submission.files.length > 0 && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Files
              </dt>
              <dd className="mt-1 space-y-1">
                {submission.files.map((f) => (
                  <a
                    key={f.field}
                    href={f.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <FileText className="size-3.5" /> {f.name}
                  </a>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </ScrollArea>

      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t pt-4">
        {hasSensitive && !revealed && (
          <Button variant="outline" onClick={doReveal} disabled={revealing}>
            {revealing ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
            Reveal credentials
          </Button>
        )}
        {submission.status === "processing" && (
          <Button onClick={() => setConfirmActive(true)}>Mark as active</Button>
        )}
        {submission.status === "active" && (
          <Button
            variant="outline"
            onClick={async () => {
              await setStatus({ id, status: "closed" });
              toast.success("Submission closed.");
              onDone();
            }}
          >
            Close request
          </Button>
        )}
      </div>

      <AlertDialog open={confirmActive} onOpenChange={setConfirmActive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this request as active?</AlertDialogTitle>
            <AlertDialogDescription>
              Only do this after verifying payment was received off-platform. The
              user will be notified that work has started.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={markActive}>
              Payment verified — mark active
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function FormsQueue() {
  const [filter, setFilter] = useState<Filter>("processing");
  const submissions =
    useQuery(api.forms.adminList, filter === "all" ? {} : { status: filter }) ?? [];
  const [openId, setOpenId] = useState<Id<"formSubmissions"> | null>(null);

  return (
    <>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList className="mb-4">
          <TabsTrigger value="processing">Processing</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="closed">Closed</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          {submissions.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing in this queue.
            </p>
          )}
          {submissions.map((s) => (
            <button
              key={s._id}
              onClick={() => setOpenId(s._id)}
              className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {getFormDef(s.formSlug)?.title ?? s.formSlug}
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.userName ?? s.userEmail} · {new Date(s._creationTime).toLocaleString()}
                </p>
              </div>
              <StatusBadge status={s.status} />
            </button>
          ))}
        </CardContent>
      </Card>

      <Dialog open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Submission detail</DialogTitle>
            <DialogDescription className="sr-only">
              Full form submission
            </DialogDescription>
          </DialogHeader>
          {openId && <SubmissionDetail id={openId} onDone={() => setOpenId(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminFormsPage() {
  return (
    <LivePage>
      <PageHeader
        title="Form Submissions"
        description="Verify payment off-platform, then mark requests active."
      />
      <FormsQueue />
    </LivePage>
  );
}
