"use client";

import { useState } from "react";
import { Eye, Plus, Trash2 } from "lucide-react";
import { renderParts, type LeadLike, type RenderedPart } from "@/lib/merge-tags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type SequenceStep = { waitDays: number; subject: string; variants: string[] };

export type PreviewLead = LeadLike & { _id: string };

const SAMPLE_LEAD: LeadLike = {
  email: "jane@acme.com",
  name: "Jane Doe",
  company: "Acme Inc",
  title: "Owner",
  phone: "+1 555 0100",
  location: "New York, US",
  industry: "Real Estate",
  website: "https://acme.com",
};

function Rendered({ parts }: { parts: RenderedPart[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>{part.text}</span>
        ) : part.kind === "missing" ? (
          <span
            key={i}
            className="rounded bg-destructive/15 px-1 font-mono text-xs text-destructive"
            title={`No ${part.tag.replace(/_/g, " ")} on this lead — sends blank unless you add a fallback like {{${part.tag}|there}}`}
          >
            {"{{"}{part.tag}{"}}"}
          </span>
        ) : (
          <span
            key={i}
            className={cn("text-primary", part.kind === "fallback" && "italic")}
            title={
              part.kind === "fallback"
                ? `Fallback for {{${part.tag}}}`
                : `From lead: ${part.tag.replace(/_/g, " ")}`
            }
          >
            {part.text}
          </span>
        ),
      )}
    </>
  );
}

/** Sequence step editor + merge-tag preview, shared by the wizard and the campaign detail page. */
export function SequenceEditor({
  steps,
  onChange,
  previewLeads,
}: {
  steps: SequenceStep[];
  onChange: (steps: SequenceStep[]) => void;
  previewLeads: PreviewLead[];
}) {
  const [previewStep, setPreviewStep] = useState<number | null>(null);
  const [previewLeadId, setPreviewLeadId] = useState<string>("");

  const previewLead: LeadLike =
    previewLeads.find((l) => l._id === previewLeadId) ??
    previewLeads[0] ??
    SAMPLE_LEAD;

  const updateStep = (idx: number, patch: Partial<SequenceStep>) =>
    onChange(steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-4">
      {steps.map((step, i) => (
        <div key={i} className="rounded-lg border p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Badge variant="outline" className="border-primary/40 text-primary">
              Email {i + 1}
            </Badge>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setPreviewStep(i)}
              >
                <Eye className="size-3.5" /> Preview
              </Button>
              {i > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Wait
                  <Input
                    className="h-7 w-14 px-2 text-center"
                    inputMode="numeric"
                    value={step.waitDays}
                    onChange={(e) =>
                      updateStep(i, { waitDays: Number(e.target.value) || 0 })
                    }
                  />
                  days
                </div>
              )}
              {steps.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove step"
                  onClick={() => onChange(steps.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
          <Input
            placeholder="Subject line"
            value={step.subject}
            onChange={(e) => updateStep(i, { subject: e.target.value })}
            className="mb-2"
          />
          {step.variants.map((variant, vi) => (
            <div key={vi} className="mb-2">
              {vi > 0 && (
                <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Variation {String.fromCharCode(65 + vi)}
                </p>
              )}
              <Textarea
                placeholder={
                  vi === 0
                    ? "Hi {{first_name}}, …"
                    : "Alternative version of this email…"
                }
                rows={4}
                value={variant}
                onChange={(e) =>
                  updateStep(i, {
                    variants: step.variants.map((v, idx) =>
                      idx === vi ? e.target.value : v,
                    ),
                  })
                }
              />
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => updateStep(i, { variants: [...step.variants, ""] })}
          >
            <Plus className="size-3.5" /> Add variation
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          onChange([...steps, { waitDays: 3, subject: "", variants: [""] }])
        }
      >
        <Plus className="size-4" /> Add follow-up email
      </Button>
      <p className="text-xs text-muted-foreground">
        Use {"{{first_name}}"}, {"{{company}}"} and {"{{email}}"} to personalize
        each send — add a fallback for missing data with {"{{first_name|there}}"}.
        Hit Preview to see it with your real leads.
      </p>

      <Dialog open={previewStep !== null} onOpenChange={(o) => !o && setPreviewStep(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Email {previewStep !== null ? previewStep + 1 : 1} preview
            </DialogTitle>
            <DialogDescription>
              {previewLeads.length > 0
                ? "Rendered with one of your leads."
                : "No leads yet — showing a sample lead."}
            </DialogDescription>
          </DialogHeader>

          {previewLeads.length > 1 && (
            <Select
              value={(previewLeads.find((l) => l._id === previewLeadId) ?? previewLeads[0])._id}
              onValueChange={setPreviewLeadId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a lead" />
              </SelectTrigger>
              <SelectContent>
                {previewLeads.map((lead) => (
                  <SelectItem key={lead._id} value={lead._id}>
                    {lead.name ? `${lead.name} — ${lead.email}` : lead.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {previewStep !== null && steps[previewStep] && (
            <div className="overflow-hidden rounded-lg border">
              <div className="border-b bg-secondary/50 px-4 py-2.5 text-sm">
                <span className="mr-2 text-xs uppercase tracking-wider text-muted-foreground">
                  Subject
                </span>
                <span className="font-medium">
                  <Rendered
                    parts={renderParts(steps[previewStep].subject || "(no subject)", previewLead)}
                  />
                </span>
              </div>
              <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed">
                <Rendered
                  parts={renderParts(
                    steps[previewStep].variants[0] || "(empty script)",
                    previewLead,
                  )}
                />
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            <span className="text-primary">Gold</span> = filled from the lead ·{" "}
            <span className="rounded bg-destructive/15 px-1 font-mono text-[10px] text-destructive">
              red tag
            </span>{" "}
            = this lead has no value, so it sends blank — add a fallback like{" "}
            {"{{first_name|there}}"}.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
