"use client";

import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ListSkeleton } from "@/components/list-skeleton";
import { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  GalleryHorizontalEnd,
  LibraryBig,
  Link2,
  Loader2,
  RotateCw,
  ScanSearch,
  Sparkles,
  Swords,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
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
import { Id } from "@/convex/_generated/dataModel";
import { costInCredits } from "@/lib/ai-models";
import {
  CAROUSEL_TEMPLATES,
  CLASSIC_TEMPLATE_ID,
  dbToTemplate,
  findCarouselTemplate,
  TEMPLATE_SAMPLE_SLIDE,
} from "@/lib/carousel-templates";
import {
  CarouselSlideFrame,
  exportSlidePng,
  readSlideEdits,
  TemplateFonts,
} from "@/components/tools/carousel-slide";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const SEVERITY_STYLES: Record<string, string> = {
  good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  warning: "border-primary/40 bg-primary/10 text-primary",
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
};

type AuditFinding = { title: string; detail: string; severity: string };
type AuditResult = {
  summary: string;
  seoFindings: AuditFinding[];
  aiVisibilityFindings: AuditFinding[];
  recommendations: string[];
  competitors: { name: string; reason: string }[];
};

function detectLinkKind(url: string): string {
  if (/youtube\.com|youtu\.be/.test(url)) return "YouTube";
  if (/instagram\.com/.test(url)) return "Instagram";
  if (/tiktok\.com/.test(url)) return "TikTok";
  return "Audio link";
}

export function AuditTab() {
  const auditsQuery = useQuery(api.tools.listAudits);
  const audits = auditsQuery ?? [];
  const runAudit = useAction(api.ai.runAudit);
  const [target, setTarget] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [openAudit, setOpenAudit] = useState<Doc<"audits"> | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);

  const run = async () => {
    if (!target.trim()) {
      toast.error("Enter your website or business name.");
      return;
    }
    setBusy(true);
    try {
      await runAudit({ target, description: description.trim() || undefined });
      toast.success("Audit complete — open it below.");
      setTarget("");
      setDescription("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(
        msg.includes("NOT_CONFIGURED")
          ? "AI tools aren't connected yet — an admin needs to add the AI key."
          : "Audit failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const result = openAudit?.result as AuditResult | undefined;

  return (
    <div>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <Label className="mb-1.5">Website or business</Label>
            <Input
              placeholder="yourbrand.com — or just describe your business"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5">Extra context (optional)</Label>
            <Textarea
              rows={2}
              placeholder="What you sell, who you serve, where you operate…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={run} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
              Run audit
            </Button>
          </div>
        </CardContent>
      </Card>

      {auditsQuery === undefined && <ListSkeleton rows={2} className="mt-6" />}
      {audits.length > 0 && (
        <Card className="mt-6">
          <CardContent className="divide-y divide-border p-0">
            {audits.map((audit) => (
              <button
                key={audit._id}
                onClick={() => setOpenAudit(audit)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{audit.target}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(audit._creationTime).toLocaleString()}
                  </p>
                </div>
                <StatusBadge status={audit.status} />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={openAudit !== null} onOpenChange={(o) => !o && setOpenAudit(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Audit — {openAudit?.target}</DialogTitle>
            <DialogDescription className="sr-only">Audit result</DialogDescription>
          </DialogHeader>
          {openAudit?.status === "failed" && (
            <p className="text-sm text-destructive">{openAudit.error}</p>
          )}
          {result && (
            <ScrollArea className="max-h-[60dvh] pr-3">
              <div className="space-y-5 text-sm">
                <p>{result.summary}</p>
                {(
                  [
                    ["SEO findings", result.seoFindings],
                    ["AI visibility", result.aiVisibilityFindings],
                  ] as const
                ).map(([title, findings]) => (
                  <div key={title}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      {title}
                    </h3>
                    <div className="space-y-2">
                      {findings.map((finding) => (
                        <div key={finding.title} className="rounded-lg border p-3">
                          <p className="flex items-center gap-2 font-medium">
                            <Badge
                              variant="outline"
                              className={cn("px-1.5 py-0 text-[10px] uppercase", SEVERITY_STYLES[finding.severity])}
                            >
                              {finding.severity}
                            </Badge>
                            {finding.title}
                          </p>
                          <p className="mt-1 text-muted-foreground">{finding.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    <Swords className="size-3.5" /> Competitors
                  </h3>
                  <div className="space-y-2">
                    {result.competitors.map((competitor) => (
                      <div key={competitor.name} className="rounded-lg border p-3">
                        <p className="font-medium">{competitor.name}</p>
                        <p className="mt-0.5 text-muted-foreground">{competitor.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Recommendations
                  </h3>
                  <ul className="list-disc space-y-1 pl-5">
                    {result.recommendations.map((rec) => (
                      <li key={rec}>{rec}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </ScrollArea>
          )}
          {result && openAudit && (
            <div className="border-t pt-4">
              <Button className="w-full" onClick={() => setQuoteOpen(true)}>
                <Wrench className="size-4" /> Want this fixed for you? Request a quote
              </Button>
              <p className="mt-1.5 text-center text-xs text-muted-foreground">
                Our team fixes these issues — you&apos;ll hear back with a plan
                and pricing.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {openAudit && result && (
        <FixQuoteDialog
          open={quoteOpen}
          onOpenChange={setQuoteOpen}
          target={openAudit.target}
          result={result}
        />
      )}
    </div>
  );
}

/** "Fix it for me" — files a prefilled SEO fix request into the forms queue. */
function FixQuoteDialog({
  open,
  onOpenChange,
  target,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: string;
  result: AuditResult;
}) {
  const submit = useAction(api.forms.submit);
  const [website, setWebsite] = useState(target);
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);

  const findings = [...result.seoFindings, ...result.aiVisibilityFindings];
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const auditSummary =
    `${critical} critical, ${warnings} warnings from the audit of ${target}:\n` +
    findings
      .filter((f) => f.severity !== "good")
      .slice(0, 12)
      .map((f) => `• [${f.severity}] ${f.title}`)
      .join("\n");

  const send = async () => {
    if (!website.trim()) {
      toast.error("Enter the website to fix.");
      return;
    }
    setSending(true);
    try {
      await submit({
        formSlug: "seo-fix-request",
        data: { website, auditSummary, phone, notes },
      });
      toast.success(
        "Quote request sent — our team will reach out. Track it under Forms.",
      );
      onOpenChange(false);
    } catch {
      toast.error("Couldn't send the request — please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a fix quote</DialogTitle>
          <DialogDescription>
            The audit findings go to our team with your request — no need to
            explain anything.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5">Website *</Label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5">Findings included</Label>
            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
              {auditSummary}
            </div>
          </div>
          <div>
            <Label className="mb-1.5">Phone (optional — faster callback)</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1…"
              inputMode="tel"
            />
          </div>
          <div>
            <Label className="mb-1.5">Anything else?</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Budget, timeline, priorities…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
            Request quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TranscribeTab() {
  const transcriptsQuery = useQuery(api.tools.listTranscripts);
  const transcripts = transcriptsQuery ?? [];
  const transcribe = useAction(api.ai.transcribe);
  const retryTranscribe = useAction(api.ai.retryTranscribe);
  const removeTranscript = useMutation(api.tools.removeTranscript);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [openTranscript, setOpenTranscript] = useState<Doc<"transcripts"> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Doc<"transcripts"> | null>(null);
  const [retryingId, setRetryingId] = useState<Id<"transcripts"> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const retry = async (transcript: Doc<"transcripts">) => {
    setRetryingId(transcript._id);
    try {
      await retryTranscribe({ id: transcript._id });
    } catch {
      toast.error("Couldn't retry that one. Please try again.");
    } finally {
      setRetryingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await removeTranscript({ id: deleteTarget._id });
      toast.success("Transcript deleted.");
    } catch {
      toast.error("Couldn't delete that transcript.");
    } finally {
      setDeleteTarget(null);
    }
  };

  const submitLink = async () => {
    if (!/^https?:\/\/.+/.test(link.trim())) {
      toast.error("Paste a valid link (YouTube, Instagram, TikTok or direct audio).");
      return;
    }
    setBusy(true);
    try {
      await transcribe({ sourceType: "link", source: link.trim() });
      toast.success(`${detectLinkKind(link)} submitted — check the list below.`);
      setLink("");
    } catch {
      toast.error("Couldn't submit that link. Are you signed in?");
    } finally {
      setBusy(false);
    }
  };

  const submitFile = async (file: File) => {
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "audio/mpeg" },
        body: file,
      });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = await res.json();
      await transcribe({ sourceType: "upload", source: file.name, storageId });
      toast.success("Audio uploaded — transcription in progress.");
    } catch {
      toast.error("Upload failed. Are you signed in?");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <Label className="mb-1.5">Paste a link</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="YouTube, Instagram, TikTok or direct audio URL"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button onClick={submitLink} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <AudioLines className="size-4" />}
                Transcribe
              </Button>
            </div>
            {link && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Detected: {detectLinkKind(link)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-widest text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <Upload className="size-4" /> Upload an audio file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/mp4"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && submitFile(e.target.files[0])}
          />
        </CardContent>
      </Card>

      {transcriptsQuery === undefined && <ListSkeleton rows={2} className="mt-6" />}
      {transcripts.length > 0 && (
        <Card className="mt-6">
          <CardContent className="divide-y divide-border p-0">
            {transcripts.map((transcript) => (
              <div
                key={transcript._id}
                className="flex items-center gap-2 px-5 py-3.5 transition-colors hover:bg-accent"
              >
                <button
                  onClick={() => setOpenTranscript(transcript)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{transcript.source}</p>
                    <p className="text-xs text-muted-foreground">
                      {transcript.sourceType === "link" ? detectLinkKind(transcript.source) : "Upload"} ·{" "}
                      {new Date(transcript._creationTime).toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge status={transcript.status} />
                </button>
                {transcript.status === "failed" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    title="Retry"
                    disabled={retryingId !== null}
                    onClick={() => retry(transcript)}
                  >
                    {retryingId === transcript._id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RotateCw className="size-4" />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  title="Delete"
                  onClick={() => setDeleteTarget(transcript)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={openTranscript !== null} onOpenChange={(o) => !o && setOpenTranscript(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="truncate">{openTranscript?.source}</DialogTitle>
            <DialogDescription className="sr-only">Transcript</DialogDescription>
          </DialogHeader>
          {openTranscript?.status === "failed" && (
            <p className="text-sm text-destructive">{openTranscript.error}</p>
          )}
          {openTranscript?.text && (
            <>
              <ScrollArea className="max-h-[50dvh] pr-3">
                <p className="whitespace-pre-wrap text-sm">{openTranscript.text}</p>
              </ScrollArea>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(openTranscript.text ?? "");
                  toast.success("Transcript copied.");
                }}
              >
                <Copy className="size-4" /> Copy transcript
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transcript?</AlertDialogTitle>
            <AlertDialogDescription className="truncate">
              {deleteTarget?.source}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const VIBES = ["Bold & modern", "Elegant & luxury", "Minimal & clean", "Playful & colorful"];

/**
 * Template-mode viewer. Draft: review + edit every slide, then approve —
 * credits are only charged when backgrounds render. Done: edit + export PNGs.
 */
function DeckViewer({ carousel }: { carousel: Doc<"carousels"> }) {
  const builtIn = findCarouselTemplate(carousel.templateId);
  // Library templates live in the DB — fetch by id when it isn't a built-in.
  const dbTemplateDoc = useQuery(
    api.carouselTemplates.get,
    !builtIn && carousel.templateId ? { id: carousel.templateId } : "skip",
  );
  const template =
    builtIn ?? (dbTemplateDoc ? dbToTemplate(dbTemplateDoc) : CAROUSEL_TEMPLATES[0]);
  const pricing = useQuery(api.generations.pricing);
  const updateSlide = useMutation(api.carousels.updateDeckSlide);
  const renderBackgrounds = useAction(api.ai.renderCarousel);
  const deck = carousel.deck ?? [];
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const done = carousel.status === "done";
  const draft = carousel.status === "draft";
  const editable = done || draft;
  const current = Math.min(index, deck.length - 1);
  const slide = deck[current];
  const handle = carousel.brand
    ? carousel.brand.startsWith("@")
      ? carousel.brand
      : `@${carousel.brand.replace(/\s+/g, "").toLowerCase()}`
    : undefined;

  const renderCost = pricing
    ? costInCredits({
        kind: "image",
        modelId: template.bgModelId,
        markup: pricing.markup,
        creditPriceUsd: pricing.creditPriceUsd,
      }) * deck.length
    : 0;

  /** Save any in-place text edits on the visible slide before moving on. */
  const persistEdits = async () => {
    if (!frameRef.current || !slide || !editable) return;
    const fields = readSlideEdits(frameRef.current, slide, template);
    if (!fields) return;
    try {
      await updateSlide({ id: carousel._id, index: current, fields });
    } catch {
      // never block navigation on a failed save; the DOM still has the text
    }
  };

  const goTo = async (i: number) => {
    await persistEdits();
    setIndex(i);
  };

  const approveAndRender = async () => {
    setBusy(true);
    try {
      await persistEdits();
      await renderBackgrounds({ id: carousel._id });
      toast.success("Backgrounds rendered — your carousel is ready.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("INSUFFICIENT_CREDITS")) {
        toast.error("Not enough credits — top up in Settings.");
      } else if (msg.includes("NOT_CONFIGURED")) {
        toast.error("Carousels aren't configured yet — an admin needs to add the AI keys.");
      } else if (msg.includes("refunded")) {
        toast.error("Rendering failed — your credits were refunded.");
      } else {
        toast.error("Rendering failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const downloadOne = async () => {
    if (!frameRef.current) return;
    setBusy(true);
    try {
      await persistEdits();
      await exportSlidePng(
        frameRef.current,
        template,
        `slide-${String(current + 1).padStart(2, "0")}.png`,
      );
    } catch {
      toast.error("Export failed — try again once every background has finished.");
    } finally {
      setBusy(false);
    }
  };

  const downloadAll = async () => {
    setBusy(true);
    try {
      await persistEdits();
      for (let i = 0; i < deck.length; i++) {
        setIndex(i);
        // let React remount the frame + the background image settle
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (!frameRef.current) break;
        await exportSlidePng(
          frameRef.current,
          template,
          `slide-${String(i + 1).padStart(2, "0")}.png`,
        );
      }
    } catch {
      toast.error("Export stopped partway — you can download slides one by one.");
    } finally {
      setBusy(false);
    }
  };

  if (!slide) return null;

  return (
    <div className="space-y-3">
      <TemplateFonts template={template} />
      {draft && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          This is your slide plan — nothing has been charged yet. Click any text
          to rewrite it, then generate the backgrounds when it&apos;s right.
        </p>
      )}
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <CarouselSlideFrame
          key={`${carousel._id}-${current}`}
          frameRef={frameRef}
          width={330}
          template={template}
          slide={slide}
          index={current}
          total={deck.length}
          handle={handle}
          editable={editable}
        />
        <div className="flex w-full flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={current === 0 || busy}
              onClick={() => goTo(current - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Slide {current + 1} of {deck.length}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={current >= deck.length - 1 || busy}
              onClick={() => goTo(current + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          {draft ? (
            <>
              <Button onClick={approveAndRender} disabled={busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {busy
                  ? "Painting backgrounds…"
                  : `Generate backgrounds — ${renderCost.toLocaleString()} credits`}
              </Button>
              <p className="text-xs text-muted-foreground">
                Not the right angle? Close this and plan again — planning is free.
              </p>
            </>
          ) : (
            <>
              <Button onClick={downloadOne} disabled={!done || busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Download this slide
              </Button>
              <Button variant="outline" onClick={downloadAll} disabled={!done || busy}>
                <Download className="size-4" /> Download all {deck.length} PNGs
              </Button>
            </>
          )}
          {done ? (
            <p className="text-xs text-muted-foreground">
              Tip: click any text on the slide to edit it in place, then download.
            </p>
          ) : (
            carousel.status === "running" && (
              <p className="text-xs text-muted-foreground">
                Backgrounds are rendering — slides fill in live.
              </p>
            )
          )}
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {deck.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            className={cn(
              "shrink-0 overflow-hidden rounded-md border-2 transition-opacity",
              i === current
                ? "border-primary"
                : "border-transparent opacity-60 hover:opacity-100",
            )}
          >
            <CarouselSlideFrame
              width={72}
              template={template}
              slide={s}
              index={i}
              total={deck.length}
              handle={handle}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

export function CarouselTab() {
  const carouselsQuery = useQuery(api.carousels.list);
  const carousels = carouselsQuery ?? [];
  const pricing = useQuery(api.generations.pricing);
  const generate = useAction(api.ai.generateCarousel);
  const plan = useAction(api.ai.planCarousel);
  const [templateId, setTemplateId] = useState<string>(CAROUSEL_TEMPLATES[0].id);
  const [topic, setTopic] = useState("");
  const [brand, setBrand] = useState("");
  const [colors, setColors] = useState("");
  const [vibe, setVibe] = useState(VIBES[0]);
  const [slideCount, setSlideCount] = useState("7");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<Id<"carousels"> | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const open = carousels.find((c) => c._id === openId) ?? null;

  // Built-ins + everything admins have published to the library.
  const libraryTemplates = (useQuery(api.carouselTemplates.listPublished) ?? []).map(
    dbToTemplate,
  );
  const allTemplates = [...CAROUSEL_TEMPLATES, ...libraryTemplates];

  const classic = templateId === CLASSIC_TEMPLATE_ID;
  const template = allTemplates.find((t) => t.id === templateId);
  const selectedFromLibrary =
    template && !findCarouselTemplate(template.id) ? template : null;
  const perSlide = pricing
    ? costInCredits({
        kind: "image",
        modelId: template?.bgModelId ?? "ideogram-v3",
        markup: pricing.markup,
        creditPriceUsd: pricing.creditPriceUsd,
      })
    : 0;
  const totalCredits = perSlide * Number(slideCount);

  const run = async () => {
    if (!topic.trim()) {
      toast.error("Describe what the carousel should be about.");
      return;
    }
    setBusy(true);
    try {
      if (classic) {
        const id = await generate({
          topic,
          brand: brand.trim() || undefined,
          colors: colors.trim() || undefined,
          vibe,
          slideCount: Number(slideCount),
        });
        toast.success("Carousel ready — open it below.");
        setOpenId(id);
      } else {
        // Free planning step: review + edit the slides before credits are spent.
        const id = await plan({
          topic,
          brand: brand.trim() || undefined,
          templateId,
          slideCount: Number(slideCount),
        });
        toast.success("Slide plan ready — review it before rendering.");
        setOpenId(id);
      }
      setTopic("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("NOT_CONFIGURED")) {
        toast.error("Carousels aren't configured yet — an admin needs to add the AI keys.");
      } else if (msg.includes("INSUFFICIENT_CREDITS")) {
        toast.error("Not enough credits — top up in Settings.");
      } else if (msg.includes("refunded")) {
        toast.error("Carousel failed — your credits were refunded.");
      } else if (msg.includes("Couldn't write the slides")) {
        toast.error("Couldn't write the slides. Please try again.");
      } else {
        toast.error("Carousel failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  };

  return (
    <div>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <Label className="mb-1.5">Style</Label>
            <div className="flex flex-wrap gap-3">
              {CAROUSEL_TEMPLATES.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setTemplateId(t.id)}
                  className={cn(
                    "w-[150px] rounded-xl border p-2 text-left transition-all",
                    templateId === t.id
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  <TemplateFonts template={t} />
                  <CarouselSlideFrame
                    width={132}
                    template={t}
                    slide={TEMPLATE_SAMPLE_SLIDE}
                    index={0}
                    total={5}
                    handle="@yourbrand"
                  />
                  <p className="mt-1.5 truncate text-xs font-semibold">{t.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{t.tagline}</p>
                </button>
              ))}
              {selectedFromLibrary && (
                <button
                  type="button"
                  className="w-[150px] rounded-xl border border-primary p-2 text-left ring-1 ring-primary transition-all"
                >
                  <TemplateFonts template={selectedFromLibrary} />
                  <CarouselSlideFrame
                    width={132}
                    template={selectedFromLibrary}
                    slide={TEMPLATE_SAMPLE_SLIDE}
                    index={0}
                    total={5}
                    handle="@yourbrand"
                  />
                  <p className="mt-1.5 truncate text-xs font-semibold">
                    {selectedFromLibrary.name}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {selectedFromLibrary.tagline}
                  </p>
                </button>
              )}
              <button
                type="button"
                onClick={() => setTemplateId(CLASSIC_TEMPLATE_ID)}
                className={cn(
                  "w-[150px] rounded-xl border p-2 text-left transition-all",
                  classic
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:border-primary/50",
                )}
              >
                <div className="flex aspect-[4/5] w-[132px] items-center justify-center rounded-[10px] bg-gradient-to-br from-primary/25 via-secondary to-background">
                  <Sparkles className="size-7 text-primary" />
                </div>
                <p className="mt-1.5 truncate text-xs font-semibold">AI Art</p>
                <p className="truncate text-[11px] text-muted-foreground">Model paints everything</p>
              </button>
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="w-[150px] rounded-xl border border-dashed border-border p-2 text-left transition-all hover:border-primary/50"
              >
                <div className="flex aspect-[4/5] w-[132px] flex-col items-center justify-center gap-2 rounded-[10px] bg-secondary/40">
                  <LibraryBig className="size-6 text-primary" />
                  <span className="px-2 text-center text-[11px] text-muted-foreground">
                    {allTemplates.length} styles
                  </span>
                </div>
                <p className="mt-1.5 truncate text-xs font-semibold">Library</p>
                <p className="truncate text-[11px] text-muted-foreground">Browse all styles</p>
              </button>
            </div>
            {!classic && (
              <p className="mt-2 text-xs text-muted-foreground">
                AI paints a cinematic background for every slide — your text is laid
                on top razor-sharp, editable right up until you download the PNGs.
              </p>
            )}
          </div>
          <div>
            <Label className="mb-1.5">What&apos;s the carousel about? *</Label>
            <Textarea
              rows={2}
              placeholder="5 mistakes med spas make on Instagram — and how to fix them"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label className="mb-1.5">Brand / @handle (optional)</Label>
              <Input placeholder="@booltspace" value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>
            {classic && (
              <div>
                <Label className="mb-1.5">Brand colors (optional)</Label>
                <Input placeholder="gold and black" value={colors} onChange={(e) => setColors(e.target.value)} />
              </div>
            )}
            {classic && (
              <div>
                <Label className="mb-1.5">Vibe</Label>
                <Select value={vibe} onValueChange={setVibe}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VIBES.map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="mb-1.5">Slides</Label>
              <Select value={slideCount} onValueChange={setSlideCount}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[5, 7, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} slides</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {classic
                ? `${totalCredits.toLocaleString()} credits`
                : `Plan free · ${totalCredits.toLocaleString()} credits to render`}
            </span>
            <Button onClick={run} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <GalleryHorizontalEnd className="size-4" />}
              {busy
                ? classic
                  ? "Generating — about a minute…"
                  : "Writing your slides…"
                : classic
                  ? "Generate carousel"
                  : "Write my slides — free"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {carouselsQuery === undefined && <ListSkeleton rows={2} className="mt-6" />}
      {carousels.length > 0 && (
        <Card className="mt-6">
          <CardContent className="divide-y divide-border p-0">
            {carousels.map((carousel) => (
              <button
                key={carousel._id}
                onClick={() => setOpenId(carousel._id)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{carousel.topic}</p>
                  <p className="text-xs text-muted-foreground">
                    {carousel.deck?.length ?? carousel.slides?.length ?? "…"} slides
                    {carousel.templateId
                      ? ` · ${allTemplates.find((t) => t.id === carousel.templateId)?.name ?? "Template"}`
                      : ""}{" "}
                    · {new Date(carousel._creationTime).toLocaleString()}
                  </p>
                </div>
                <StatusBadge status={carousel.status} />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Style library</DialogTitle>
            <DialogDescription>
              Pick a design system for your carousels — new styles land here
              over time.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {allTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTemplateId(t.id);
                  setLibraryOpen(false);
                }}
                className={cn(
                  "rounded-xl border p-2 text-left transition-all",
                  templateId === t.id
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:border-primary/50",
                )}
              >
                <TemplateFonts template={t} />
                <CarouselSlideFrame
                  width={140}
                  template={t}
                  slide={TEMPLATE_SAMPLE_SLIDE}
                  index={0}
                  total={5}
                  handle="@yourbrand"
                />
                <p className="mt-1.5 truncate text-xs font-semibold">{t.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{t.tagline}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="line-clamp-1">{open?.topic}</DialogTitle>
            <DialogDescription>
              {open &&
                `${open.deck?.length ?? open.slides?.length ?? 0} slides · ${
                  open.status === "draft"
                    ? "draft — nothing charged"
                    : `${open.costCredits} credits`
                }`}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {open?.status === "failed" && (
              <p className="text-sm text-destructive">{open.error}</p>
            )}
            {open?.status === "running" && (
              <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-sm text-sky-300">
                Designing your slides — they appear below as each one finishes.
              </p>
            )}
            {open?.deck && open.deck.length > 0 && <DeckViewer carousel={open} />}
            {open?.slides && !open.deck && (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {open.slides.map((slide, i) => (
                  <div key={i} className="w-52 shrink-0">
                    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary">
                      {slide.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={slide.imageUrl} alt={slide.heading} className="h-full w-full object-cover" />
                      ) : (
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-xs font-medium">
                      {i + 1}. {slide.heading}
                    </p>
                    {slide.imageUrl && (
                      <a
                        href={slide.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-primary hover:underline"
                      >
                        Open full size
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
            {open?.caption && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Caption
                  </p>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => copy(open.caption!, "Caption")}>
                    <Copy className="size-3.5" /> Copy
                  </Button>
                </div>
                <p className="whitespace-pre-wrap rounded-lg border bg-secondary/30 px-3 py-2 text-sm">
                  {open.caption}
                </p>
              </div>
            )}
            {open?.hashtags && open.hashtags.length > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Hashtags
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => copy(open.hashtags!.map((h) => `#${h}`).join(" "), "Hashtags")}
                  >
                    <Copy className="size-3.5" /> Copy
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {open.hashtags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-muted-foreground">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
