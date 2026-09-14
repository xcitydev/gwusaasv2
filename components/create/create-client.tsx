"use client";

import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { GridSkeleton } from "@/components/list-skeleton";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Clapperboard,
  ClipboardCopy,
  Coins,
  Download,
  ExternalLink,
  ImageIcon,
  Library,
  Link as LinkIcon,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  costInCredits,
  findImageModel,
  findVideoModel,
} from "@/lib/ai-models";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

function CostPill({ credits }: { credits: number }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
      <Coins className="size-3.5" /> {credits.toLocaleString()} credits
    </span>
  );
}

/** "Enhance with AI" — rewrites the prompt in place, with undo in the toast. */
function EnhanceButton({
  kind,
  prompt,
  onEnhanced,
}: {
  kind: "image" | "video";
  prompt: string;
  onEnhanced: (next: string) => void;
}) {
  const enhance = useAction(api.ai.enhancePrompt);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-xs text-primary"
      disabled={busy || !prompt.trim()}
      onClick={async () => {
        setBusy(true);
        const previous = prompt;
        try {
          const next = await enhance({ kind, prompt });
          onEnhanced(next);
          toast.success("Prompt enhanced.", {
            action: { label: "Undo", onClick: () => onEnhanced(previous) },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          toast.error(
            msg.includes("NOT_CONFIGURED")
              ? "AI enhancement isn't configured yet."
              : "Couldn't enhance the prompt — try again.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
      Enhance with AI
    </Button>
  );
}

/** Reference image: paste a link OR upload a file (stored on Convex). */
function ReferenceInput({
  value,
  onChange,
  helper,
}: {
  value: string;
  onChange: (url: string) => void;
  helper?: string;
}) {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const getPublicUrl = useMutation(api.files.getPublicUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = await res.json();
      onChange(await getPublicUrl({ storageId }));
      toast.success("Reference image uploaded.");
    } catch {
      toast.error("Upload failed — try again or paste a link.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <Input
          placeholder="https://… or upload an image"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <Button
          type="button"
          variant="outline"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Upload
        </Button>
      </div>
      {value.trim() && (
        <div className="mt-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Reference preview"
            className="h-16 w-16 rounded-lg border border-border object-cover"
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => onChange("")}
          >
            <X className="size-3.5" /> Remove
          </Button>
        </div>
      )}
      {helper && !value.trim() && (
        <p className="mt-1.5 text-xs text-muted-foreground">{helper}</p>
      )}
    </div>
  );
}

function handleGenerateError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("NOT_CONFIGURED")) {
    toast.error("The generation engine isn't connected yet — an admin needs to add the provider key.");
  } else if (message.includes("INSUFFICIENT_CREDITS")) {
    toast.error("Not enough credits — top up in Settings.");
  } else if (message.includes("refunded")) {
    toast.error("Generation failed — your credits were refunded.");
  } else {
    toast.error("Generation failed. Are you signed in?");
  }
}

function ImageStudio() {
  const pricing = useQuery(api.generations.pricing);
  const generate = useAction(api.createActions.generate);
  const [modelId, setModelId] = useState(IMAGE_MODELS[0].id);
  const [resolution, setResolution] = useState(IMAGE_MODELS[0].resolutions[0]);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const model = findImageModel(modelId)!;
  const credits = pricing
    ? costInCredits({ kind: "image", modelId, markup: pricing.markup, creditPriceUsd: pricing.creditPriceUsd })
    : 0;

  const run = async () => {
    if (!prompt.trim()) {
      toast.error("Write a prompt first.");
      return;
    }
    setBusy(true);
    try {
      await generate({
        kind: "image",
        modelId,
        prompt,
        resolution,
        referenceUrl: referenceUrl.trim() || undefined,
      });
      toast.success("Image generated — see it in your Library.");
      setPrompt("");
    } catch (e) {
      handleGenerateError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5">Model</Label>
            <Select
              value={modelId}
              onValueChange={(id) => {
                setModelId(id);
                setResolution(findImageModel(id)!.resolutions[0]);
              }}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {IMAGE_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5">Resolution</Label>
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {model.resolutions.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="mb-1.5">Reference image (optional)</Label>
          <ReferenceInput
            value={referenceUrl}
            onChange={setReferenceUrl}
            helper="Used by editing models — pick Nano Banana (edit) to transform your image."
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Prompt</Label>
            <EnhanceButton kind="image" prompt={prompt} onEnhanced={setPrompt} />
          </div>
          <Textarea
            rows={4}
            placeholder="A cinematic product shot of a gold watch on black marble, dramatic lighting…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between">
          <CostPill credits={credits} />
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Generate image
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function VideoStudio() {
  const pricing = useQuery(api.generations.pricing);
  const generate = useAction(api.createActions.generate);
  const [modelId, setModelId] = useState(VIDEO_MODELS[0].id);
  const model = findVideoModel(modelId)!;
  const [duration, setDuration] = useState(model.durations[0]);
  const [resolution, setResolution] = useState(model.resolutions[0]);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const credits = pricing
    ? costInCredits({ kind: "video", modelId, durationSec: duration, markup: pricing.markup, creditPriceUsd: pricing.creditPriceUsd })
    : 0;

  const run = async () => {
    if (!prompt.trim()) {
      toast.error("Write a prompt first.");
      return;
    }
    setBusy(true);
    try {
      await generate({
        kind: "video",
        modelId,
        prompt,
        resolution,
        durationSec: duration,
        referenceUrl: referenceUrl.trim() || undefined,
      });
      toast.success("Video generated — see it in your Library.");
      setPrompt("");
    } catch (e) {
      handleGenerateError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label className="mb-1.5">Model</Label>
            <Select
              value={modelId}
              onValueChange={(id) => {
                const next = findVideoModel(id)!;
                setModelId(id);
                setDuration(next.durations[0]);
                setResolution(next.resolutions[0]);
              }}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VIDEO_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5">Duration</Label>
            <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {model.durations.map((d) => (
                  <SelectItem key={d} value={String(d)}>{d} seconds</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5">Resolution</Label>
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {model.resolutions.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {model.supportsReference && (
          <div>
            <Label className="mb-1.5">Reference image (optional)</Label>
            <ReferenceInput
              value={referenceUrl}
              onChange={setReferenceUrl}
              helper="An image to animate — the video starts from this frame."
            />
          </div>
        )}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Prompt</Label>
            <EnhanceButton kind="video" prompt={prompt} onEnhanced={setPrompt} />
          </div>
          <Textarea
            rows={4}
            placeholder="Slow dolly-in on a luxury storefront at dusk, warm gold signage glowing…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between">
          <CostPill credits={credits} />
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />}
            Generate video
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LibraryGrid() {
  const generationsQuery = useQuery(api.generations.list);
  const generations = generationsQuery ?? [];
  const removeGeneration = useMutation(api.generations.remove);
  const [openId, setOpenId] = useState<Id<"generations"> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const open = generations.find((g) => g._id === openId) ?? null;

  const download = async () => {
    if (!open?.resultUrl) return;
    setDownloading(true);
    try {
      // Cross-origin URLs ignore the download attribute — fetch to a blob.
      const res = await fetch(open.resultUrl);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const extension =
        open.resultUrl.split("?")[0].match(/\.(\w{2,4})$/)?.[1] ??
        (open.kind === "video" ? "mp4" : "png");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${open.model}-${open._id.slice(-6)}.${extension}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      // CORS blocked the blob route — open it instead so they can save manually.
      window.open(open.resultUrl, "_blank", "noopener");
      toast.info("Opened in a new tab — right-click to save.");
    } finally {
      setDownloading(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast.error("Clipboard blocked by the browser.");
    }
  };

  if (generationsQuery === undefined) {
    return <GridSkeleton />;
  }
  if (generations.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Library className="size-8 text-muted-foreground" />
          <p className="font-medium">Nothing generated yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Everything you create is stored here forever — images, videos and edits.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {generations.map((g) => (
          <button
            key={g._id}
            onClick={() => setOpenId(g._id)}
            className="group text-left"
            aria-label={`Open ${g.prompt}`}
          >
            <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-secondary transition-colors group-hover:border-primary/50">
              {g.status === "done" && g.resultUrl ? (
                g.kind === "video" ? (
                  <video src={g.resultUrl} muted className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.resultUrl} alt={g.prompt} className="h-full w-full object-cover" />
                )
              ) : (
                <div className="flex h-full items-center justify-center">
                  <StatusBadge status={g.status} />
                </div>
              )}
              {g.kind === "video" && (
                <span className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-white">
                  <Clapperboard className="size-3.5" />
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate text-xs">{g.prompt}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {g.costCredits} cr · {new Date(g._creationTime).toLocaleDateString()}
            </p>
          </button>
        ))}
      </div>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="line-clamp-2 pr-6 text-base font-medium">
              {open?.prompt}
            </DialogTitle>
            <DialogDescription>
              {open &&
                `${open.model} · ${open.costCredits} credits · ${new Date(open._creationTime).toLocaleString()}`}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {open?.status === "done" && open.resultUrl ? (
              open.kind === "video" ? (
                <video
                  src={open.resultUrl}
                  controls
                  autoPlay
                  className="max-h-[55dvh] w-full rounded-lg bg-black object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={open.resultUrl}
                  alt={open.prompt}
                  className="max-h-[55dvh] w-full rounded-lg object-contain"
                />
              )
            ) : (
              <div className="flex items-center justify-center py-16">
                {open && <StatusBadge status={open.status} />}
                {open?.error && (
                  <p className="ml-3 text-sm text-muted-foreground">{open.error}</p>
                )}
              </div>
            )}
          </div>

          {open?.status === "done" && open.resultUrl && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button onClick={download} disabled={downloading}>
                {downloading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Download
              </Button>
              <Button variant="outline" onClick={() => copy(open.resultUrl!, "Link")}>
                <LinkIcon className="size-4" /> Copy link
              </Button>
              <Button variant="outline" onClick={() => copy(open.prompt, "Prompt")}>
                <ClipboardCopy className="size-4" /> Copy prompt
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open(open.resultUrl!, "_blank", "noopener")}
              >
                <ExternalLink className="size-4" /> Full size
              </Button>
              <Button
                variant="outline"
                className="ml-auto"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4 text-destructive" /> Delete
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this generation?</AlertDialogTitle>
            <AlertDialogDescription>
              It&apos;s removed from your library permanently. Credits already
              spent aren&apos;t refunded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!open) return;
                try {
                  await removeGeneration({ id: open._id });
                  setConfirmDelete(false);
                  setOpenId(null);
                  toast.success("Deleted from your library.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Delete failed.");
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function CreateClient() {
  return (
    <Tabs defaultValue="image">
      <TabsList className="mb-4">
        <TabsTrigger value="image" className="gap-1.5">
          <ImageIcon className="size-4" /> Image
        </TabsTrigger>
        <TabsTrigger value="video" className="gap-1.5">
          <Clapperboard className="size-4" /> Video
        </TabsTrigger>
        <TabsTrigger value="library" className="gap-1.5">
          <Library className="size-4" /> Library
        </TabsTrigger>
      </TabsList>
      <TabsContent value="image"><ImageStudio /></TabsContent>
      <TabsContent value="video"><VideoStudio /></TabsContent>
      <TabsContent value="library"><LibraryGrid /></TabsContent>
    </Tabs>
  );
}
