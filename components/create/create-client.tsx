"use client";

import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { GridSkeleton } from "@/components/list-skeleton";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Bot,
  Clapperboard,
  ClipboardCopy,
  Coins,
  Download,
  ExternalLink,
  ImageIcon,
  Library,
  PersonStanding,
  Film,
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
  MOTION_MAX_SECONDS,
  MOTION_MODELS,
  VIDEO_MODELS,
  costInCredits,
  findImageModel,
  findMotionModel,
  findVideoModel,
  type MotionOrientation,
} from "@/lib/ai-models";
import { cn } from "@/lib/utils";
import { StudioTab } from "./studio-tab";
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
import { HubTab } from "@/components/hub/hub-client";
import { handleGenerateError, probeVideoDuration } from "@/components/create/generate-helpers";

export { handleGenerateError };
import { Textarea } from "@/components/ui/textarea";

export function CostPill({ credits }: { credits: number }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
      <Coins className="size-3.5" /> {credits.toLocaleString()} credits
    </span>
  );
}

/** "Enhance with AI" — rewrites the prompt in place, with undo in the toast. */
export function EnhanceButton({
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
export function ReferenceInput({
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

// Driving videos are uploaded to Convex storage; keep them small enough to
// upload quickly and for fal to fetch without timing out.
const MAX_VIDEO_UPLOAD_MB = 80;

export function DrivingVideoInput({
  value,
  durationSec,
  onChange,
}: {
  value: string;
  durationSec: number | null;
  onChange: (url: string, durationSec: number | null) => void;
}) {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const getPublicUrl = useMutation(api.files.getPublicUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (file.size > MAX_VIDEO_UPLOAD_MB * 1024 * 1024) {
      toast.error(`Keep the video under ${MAX_VIDEO_UPLOAD_MB} MB — trim it to the part you need.`);
      return;
    }
    setUploading(true);
    try {
      const objectUrl = URL.createObjectURL(file);
      const seconds = await probeVideoDuration(objectUrl);
      URL.revokeObjectURL(objectUrl);
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "video/mp4" },
        body: file,
      });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = await res.json();
      onChange(await getPublicUrl({ storageId }), seconds);
      toast.success("Motion video uploaded.");
    } catch {
      toast.error("Upload failed — try again or paste a link.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // A pasted link is measured once the user leaves the field.
  const measureLink = async () => {
    const url = value.trim();
    if (url && durationSec === null) onChange(url, await probeVideoDuration(url));
  };

  return (
    <div>
      <div className="flex gap-2">
        <Input
          placeholder="https://… or upload a video"
          value={value}
          onChange={(e) => onChange(e.target.value, null)}
          onBlur={() => void measureLink()}
          onKeyDown={(e) => e.key === "Enter" && void measureLink()}
          className="flex-1"
        />
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/*"
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
      {value.trim() ? (
        <div className="mt-2 flex items-center gap-3">
          <video
            src={value}
            muted
            playsInline
            className="h-20 w-14 rounded-lg border border-border bg-black object-cover"
          />
          <p className="text-xs text-muted-foreground">
            {durationSec !== null
              ? `${Math.ceil(durationSec)} second${Math.ceil(durationSec) === 1 ? "" : "s"}`
              : "Length unknown — it's read from the file when you generate"}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground"
            onClick={() => onChange("", null)}
          >
            <X className="size-3.5" /> Remove
          </Button>
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">
          A clip of one person talking or moving — face clearly visible, upper
          body in frame, steady camera. Its audio is kept so the lips stay in
          sync.
        </p>
      )}
    </div>
  );
}

/** Character image performs the motion (and speech) of a driving video. */
function MotionStudio() {
  const pricing = useQuery(api.generations.pricing);
  const generate = useAction(api.createActions.generate);
  const models = MOTION_MODELS.filter((m) => m.available);
  const [modelId, setModelId] = useState(models[0].id);
  const [orientation, setOrientation] = useState<MotionOrientation>("video");
  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoSec, setVideoSec] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const model = findMotionModel(modelId)!;
  const maxSec = MOTION_MAX_SECONDS[orientation];
  const tooLong = videoSec !== null && videoSec > maxSec;
  const credits =
    pricing && videoSec
      ? costInCredits({
          kind: "motion",
          modelId,
          durationSec: videoSec,
          markup: pricing.markup,
          creditPriceUsd: pricing.creditPriceUsd,
        })
      : 0;

  const run = async () => {
    if (!imageUrl.trim()) {
      toast.error("Add the character image first.");
      return;
    }
    if (!videoUrl.trim()) {
      toast.error("Add the motion video first.");
      return;
    }
    if (tooLong) {
      toast.error(`Keep the motion video under ${maxSec} seconds for this background setting.`);
      return;
    }
    setBusy(true);
    try {
      await generate({
        kind: "motion",
        modelId,
        prompt,
        resolution: "auto",
        durationSec: videoSec ?? undefined,
        referenceUrl: imageUrl.trim(),
        videoUrl: videoUrl.trim(),
        characterOrientation: orientation,
      });
      toast.success("Motion video generated — see it in your Library.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/motion video|character image|under \d+ seconds/.test(message)) {
        toast.error(message.split("Uncaught Error: ").pop() ?? message);
      } else {
        handleGenerateError(e);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5">Character image</Label>
            <ReferenceInput
              value={imageUrl}
              onChange={setImageUrl}
              helper="One person, face and upper body clearly visible, nothing covering them."
            />
          </div>
          <div>
            <Label className="mb-1.5">Motion video</Label>
            <DrivingVideoInput
              value={videoUrl}
              durationSec={videoSec}
              onChange={(url, seconds) => {
                setVideoUrl(url);
                setVideoSec(seconds);
              }}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5">Model</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-xs text-muted-foreground">{model.hint}</p>
          </div>
          <div>
            <Label className="mb-1.5">Scene control — follow the</Label>
            <div
              role="radiogroup"
              aria-label="Background source"
              className="grid grid-cols-2 gap-1 rounded-lg bg-secondary/60 p-1"
            >
              {(
                [
                  ["image", "Character image"],
                  ["video", "Motion video"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={orientation === value}
                  onClick={() => setOrientation(value)}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-sm transition-colors",
                    orientation === value
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className={cn("mt-1.5 text-xs", tooLong ? "text-destructive" : "text-muted-foreground")}>
              {orientation === "image"
                ? `The image leads the framing — best for camera moves. Video up to ${MOTION_MAX_SECONDS.image} s.`
                : `The video leads the framing — best for complex motion. Video up to ${MOTION_MAX_SECONDS.video} s.`}
              {tooLong && ` Your clip is ${Math.ceil(videoSec!)} s.`}
            </p>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Prompt (optional)</Label>
            <EnhanceButton kind="video" prompt={prompt} onEnhanced={setPrompt} />
          </div>
          <Textarea
            rows={2}
            placeholder="Optional styling notes — the motion and speech come from the video."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CostPill credits={credits} />
            {videoSec ? (
              <span className="text-xs text-muted-foreground">
                for {Math.ceil(videoSec)} s of output
              </span>
            ) : null}
          </div>
          <Button onClick={run} disabled={busy || tooLong}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <PersonStanding className="size-4" />}
            {busy ? "Generating… (a few minutes)" : "Generate motion video"}
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
        (open.kind === "video" || open.kind === "motion" ? "mp4" : "png");
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
                g.kind === "video" || g.kind === "motion" ? (
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
              {(g.kind === "video" || g.kind === "motion") && (
                <span className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-white">
                  {g.kind === "motion" ? (
                    <PersonStanding className="size-3.5" />
                  ) : (
                    <Clapperboard className="size-3.5" />
                  )}
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate text-xs">{g.prompt}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {g.provider === "higgsfield" && (
                <span className="mr-1 rounded bg-primary/15 px-1 text-[10px] text-primary">Studio</span>
              )}
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
              open.kind === "video" || open.kind === "motion" ? (
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
  const [tab, setTab] = useState("hub");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="mb-4">
        <TabsTrigger value="hub" className="gap-1.5">
          <Bot className="size-4" /> AI Hub
        </TabsTrigger>
        <TabsTrigger value="image" className="gap-1.5">
          <ImageIcon className="size-4" /> Image
        </TabsTrigger>
        <TabsTrigger value="video" className="gap-1.5">
          <Clapperboard className="size-4" /> Video
        </TabsTrigger>
        <TabsTrigger value="motion" className="gap-1.5">
          <PersonStanding className="size-4" /> Motion
        </TabsTrigger>
        <TabsTrigger value="studio" className="gap-1.5">
          <Film className="size-4" /> Studio
        </TabsTrigger>
        <TabsTrigger value="library" className="gap-1.5">
          <Library className="size-4" /> Library
        </TabsTrigger>
      </TabsList>
      {/* Kept mounted so in-flight hub renders keep their cards while you peek at other tabs. */}
      <TabsContent value="hub" forceMount className="data-[state=inactive]:hidden">
        <HubTab onOpenLibrary={() => setTab("library")} />
      </TabsContent>
      <TabsContent value="image"><ImageStudio /></TabsContent>
      <TabsContent value="video"><VideoStudio /></TabsContent>
      <TabsContent value="motion"><MotionStudio /></TabsContent>
      <TabsContent value="studio"><StudioTab /></TabsContent>
      <TabsContent value="library"><LibraryGrid /></TabsContent>
    </Tabs>
  );
}
