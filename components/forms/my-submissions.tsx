"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Paperclip } from "lucide-react";
import { hasConvex } from "@/lib/runtime";
import { getFormDef } from "@/lib/forms-def";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function SubmissionDialog({
  id,
  onClose,
}: {
  id: Id<"formSubmissions">;
  onClose: () => void;
}) {
  const submission = useQuery(api.forms.getMine, { id });
  const def = submission ? getFormDef(submission.formSlug) : undefined;

  // Field order from the form definition, then any extra keys just in case.
  const entries: { label: string; value: string }[] = [];
  if (submission) {
    const data = submission.data as Record<string, unknown>;
    const seen = new Set<string>();
    for (const field of def?.fields ?? []) {
      seen.add(field.name);
      const value = data[field.name];
      if (value === undefined || value === null || value === "") continue;
      if (field.type === "file") continue; // rendered from files below
      entries.push({
        label: field.label,
        value:
          field.type === "toggle"
            ? value
              ? "Yes"
              : "No"
            : String(value),
      });
    }
    for (const [key, value] of Object.entries(data)) {
      if (seen.has(key) || value === undefined || value === null || value === "")
        continue;
      entries.push({ label: key, value: String(value) });
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{def?.title ?? submission?.formSlug ?? "Request"}</DialogTitle>
          <DialogDescription>
            {submission &&
              `Submitted ${new Date(submission._creationTime).toLocaleString()}`}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {submission === undefined && (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          )}
          {submission === null && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              This request isn&apos;t available.
            </p>
          )}
          {submission && (
            <>
              <div className="flex items-center justify-between rounded-lg border bg-secondary/30 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Status
                </span>
                <StatusBadge status={submission.status} />
              </div>
              {entries.map(({ label, value }) => (
                <div key={label}>
                  <p className="mb-0.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {label}
                  </p>
                  <p className="whitespace-pre-wrap rounded-lg border bg-secondary/30 px-3 py-2 text-sm">
                    {value}
                  </p>
                </div>
              ))}
              {submission.files.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Attached files
                  </p>
                  <div className="space-y-1.5">
                    {submission.files.map((file, i) =>
                      file.url ? (
                        <a
                          key={i}
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 rounded-lg border bg-secondary/30 px-3 py-2 text-sm text-primary hover:border-primary/40"
                        >
                          <Paperclip className="size-3.5 shrink-0" />
                          <span className="truncate">{file.name}</span>
                        </a>
                      ) : (
                        <p
                          key={i}
                          className="flex items-center gap-2 rounded-lg border bg-secondary/30 px-3 py-2 text-sm text-muted-foreground"
                        >
                          <Paperclip className="size-3.5 shrink-0" />
                          <span className="truncate">{file.name}</span>
                        </p>
                      ),
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LiveList() {
  const submissions = useQuery(api.forms.mine) ?? [];
  const [openId, setOpenId] = useState<Id<"formSubmissions"> | null>(null);
  if (submissions.length === 0) return null;
  return (
    <>
      <h2 className="mb-3 mt-10 text-sm font-medium uppercase tracking-widest text-muted-foreground">
        My requests
      </h2>
      <Card>
        <CardContent className="divide-y divide-border p-0">
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
                  {new Date(s._creationTime).toLocaleDateString()}
                </p>
              </div>
              <StatusBadge status={s.status} />
            </button>
          ))}
        </CardContent>
      </Card>
      {openId && <SubmissionDialog id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

export function MySubmissions() {
  if (!hasConvex) return null;
  return <LiveList />;
}
