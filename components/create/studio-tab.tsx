"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { hasConvex } from "@/lib/runtime";
import {
  AlertTriangle,
  Clapperboard,
  ClipboardCopy,
  Coins,
  ExternalLink,
  Gem,
  ImageIcon,
  ImagePlus,
  Link as LinkIcon,
  Loader2,
  Minus,
  PersonStanding,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Upload,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  STUDIO_FAMILIES,
  STUDIO_MODELS,
  findStudioModel,
  normalizeStudioInput,
  studioCreditsFromUsd,
  studioListUsd,
  tokenMeteredUsd,
  type StudioFamily,
  type StudioField,
  type StudioModel,
} from "@/lib/studio-models";
import { cn } from "@/lib/utils";
import { EnhanceButton, handleGenerateError } from "./create-client";
import { probeVideoDuration } from "./generate-helpers";
import { errorText } from "@/lib/public-errors";

// Knobs that get their own chip in the composer; the rest live under "Settings".
const CHIP_KEYS = new Set(["aspect_ratio", "resolution"]);
const MAX_VIDEO_UPLOAD_MB = 80;

const FAMILY_ICON: Record<StudioFamily, typeof ImageIcon> = {
  image: ImageIcon,
  video: Clapperboard,
  genjutsu: Wand2,
  motion: PersonStanding,
};

const chipClass =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary data-[state=open]:bg-secondary disabled:pointer-events-none disabled:opacity-50";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function defaultOptions(model: StudioModel): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const field of model.fields) {
    if (field.type === "toggle") out[field.key] = field.default;
    else if (field.default !== undefined) out[field.key] = field.default;
  }
  return out;
}

const isVideoGen = (g: Doc<"generations">) => g.kind === "video" || g.kind === "motion";

/** Uploads a file to Convex storage and returns its public URL. */
function useUploader() {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const getPublicUrl = useMutation(api.files.getPublicUrl);
  return useCallback(
    async (file: File): Promise<string> => {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = await res.json();
      return await getPublicUrl({ storageId });
    },
    [generateUploadUrl, getPublicUrl],
  );
}

/** A tiny rectangle drawn in the ratio's shape, like the reference picker. */
function RatioIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) {
    return <span className="inline-block size-3.5 rounded-[3px] border-[1.5px] border-dashed border-current" />;
  }
  const scale = 14 / Math.max(w, h);
  return (
    <span
      className="inline-block shrink-0 rounded-[3px] border-[1.5px] border-current"
      style={{ width: Math.max(6, w * scale), height: Math.max(6, h * scale) }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Composer pieces                                                      */
/* ------------------------------------------------------------------ */

function ModelPicker({
  model,
  onPick,
}: {
  model: StudioModel;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = FAMILY_ICON[model.family];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={chipClass} aria-label="Choose a model">
          <Icon className="size-4 text-primary" />
          <span className="max-w-[11rem] truncate">{model.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList className="max-h-[min(26rem,60dvh)]">
            <CommandEmpty>No model matches.</CommandEmpty>
            {STUDIO_FAMILIES.map((family) => {
              const FamilyIcon = FAMILY_ICON[family.value];
              return (
                <CommandGroup key={family.value} heading={family.label}>
                  {STUDIO_MODELS.filter((m) => m.family === family.value).map((m) => (
                    <CommandItem
                      key={m.id}
                      value={`${m.label} ${m.tagline} ${family.label}`}
                      data-checked={m.id === model.id}
                      onSelect={() => {
                        onPick(m.id);
                        setOpen(false);
                      }}
                      className="items-start gap-3 rounded-lg py-2"
                    >
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/60">
                        <FamilyIcon className="size-4 text-muted-foreground" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{m.label}</span>
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {m.tagline}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A select field shown as a chip with a popover list (aspect ratio, resolution). */
function OptionChip({
  field,
  value,
  onChange,
}: {
  field: Extract<StudioField, { type: "select" }>;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const isAspect = field.key === "aspect_ratio";
  const current = field.options.find((o) => o.value === value);
  const shown = current?.label ?? "Auto";
  const choices: { value: string | undefined; label: string }[] = [
    ...(field.optional ? [{ value: undefined, label: "Auto" }] : []),
    ...field.options,
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={chipClass} aria-label={field.label}>
          {isAspect ? <RatioIcon ratio={value ?? "auto"} /> : <Gem className="size-3.5" />}
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-48 gap-0 p-1.5">
        <p className="px-2 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">{field.label}</p>
        <div className="max-h-[min(22rem,55dvh)] overflow-y-auto">
          {choices.map((choice) => {
            const selected = choice.value === value;
            return (
              <button
                key={choice.value ?? "__auto"}
                type="button"
                onClick={() => {
                  onChange(choice.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
                  selected && "bg-muted",
                )}
              >
                {isAspect && <RatioIcon ratio={choice.value ?? "auto"} />}
                <span className="flex-1 font-medium">{choice.label}</span>
                {selected && <span className="text-xs text-primary">✓</span>}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** "− value +" pill — image count, clip length. */
function Stepper({
  label,
  icon,
  display,
  canDec,
  canInc,
  onDec,
  onInc,
}: {
  label: string;
  icon?: React.ReactNode;
  display: string;
  canDec: boolean;
  canInc: boolean;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div
      className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-secondary/50 text-sm font-medium"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        onClick={onDec}
        disabled={!canDec}
        aria-label={`Less ${label.toLowerCase()}`}
        className="flex h-full items-center px-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="flex min-w-10 items-center justify-center gap-1 tabular-nums">
        {icon}
        {display}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={!canInc}
        aria-label={`More ${label.toLowerCase()}`}
        className="flex h-full items-center px-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

/** Every knob that doesn't get its own chip. */
function SettingsChip({
  fields,
  options,
  onChange,
}: {
  fields: StudioField[];
  options: Record<string, string | boolean>;
  onChange: (key: string, next: string | boolean | undefined) => void;
}) {
  const changed = fields.filter((f) => {
    const v = options[f.key];
    return f.type === "toggle" ? v !== f.default : v !== undefined && v !== f.default;
  }).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={chipClass} aria-label="More settings">
          <SlidersHorizontal className="size-3.5" />
          Settings
          {changed > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 text-[11px] text-primary">{changed}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3">
        <p className="text-xs font-medium text-muted-foreground">Settings</p>
        <div className="max-h-[min(26rem,55dvh)] space-y-3 overflow-y-auto pr-1">
          {fields.map((field) =>
            field.type === "toggle" ? (
              <label
                key={field.key}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span>
                  <span className="block text-sm">{field.label}</span>
                  {field.helper && (
                    <span className="block text-xs text-muted-foreground">{field.helper}</span>
                  )}
                </span>
                <Switch
                  checked={Boolean(options[field.key])}
                  onCheckedChange={(checked) => onChange(field.key, checked)}
                  aria-label={field.label}
                />
              </label>
            ) : (
              <div key={field.key}>
                <p className="mb-1.5 text-xs font-medium">{field.label}</p>
                <div className="flex flex-wrap gap-1">
                  {[
                    ...(field.optional ? [{ value: undefined as string | undefined, label: "Auto" }] : []),
                    ...field.options,
                  ].map((option) => {
                    const selected = (options[field.key] as string | undefined) === option.value;
                    return (
                      <button
                        key={option.value ?? "__auto"}
                        type="button"
                        onClick={() => onChange(field.key, option.value)}
                        className={cn(
                          "rounded-md border px-2 py-1 text-xs transition-colors",
                          selected
                            ? "border-primary/50 bg-primary/15 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {field.helper && (
                  <p className="mt-1 text-xs text-muted-foreground">{field.helper}</p>
                )}
              </div>
            ),
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One reference slot in the composer: a thumbnail when filled, otherwise a
 * dashed tile that opens upload / paste link / pick from your generations.
 */
function MediaSlot({
  kind,
  label,
  value,
  caption,
  generations,
  onChange,
}: {
  kind: "image" | "video";
  label: string;
  value: string;
  caption?: string;
  generations: Doc<"generations">[];
  onChange: (url: string, seconds?: number | null) => void;
}) {
  const upload = useUploader();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const picks = generations
    .filter((g) => g.status === "done" && g.resultUrl && (kind === "video") === isVideoGen(g))
    .slice(0, 12);

  const choose = async (url: string) => {
    setOpen(false);
    setLink("");
    if (kind === "video") onChange(url, await probeVideoDuration(url));
    else onChange(url);
  };

  const handleFile = async (file: File) => {
    if (kind === "video" && file.size > MAX_VIDEO_UPLOAD_MB * 1024 * 1024) {
      toast.error(`Keep the video under ${MAX_VIDEO_UPLOAD_MB} MB — trim it to the part you need.`);
      return;
    }
    setUploading(true);
    try {
      let seconds: number | null = null;
      if (kind === "video") {
        const objectUrl = URL.createObjectURL(file);
        seconds = await probeVideoDuration(objectUrl);
        URL.revokeObjectURL(objectUrl);
      }
      const url = await upload(file);
      onChange(url, seconds);
      setOpen(false);
    } catch {
      toast.error("Upload failed — try again or paste a link.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (value) {
    return (
      <div className="w-16 shrink-0">
        <div className="group relative size-16 overflow-hidden rounded-xl border border-border bg-secondary">
          {kind === "video" ? (
            <video src={`${value}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={label} className="h-full w-full object-cover" />
          )}
          <button
            type="button"
            onClick={() => onChange("", null)}
            aria-label={`Remove ${label.toLowerCase()}`}
            className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5 text-white opacity-90 transition-opacity hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
        <p className="mt-1 truncate text-center text-[10px] text-muted-foreground" title={label}>
          {caption ?? label}
        </p>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="w-16 shrink-0">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex size-16 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-secondary/30 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground data-[state=open]:border-primary/50"
            aria-label={`Add ${label.toLowerCase()}`}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : kind === "video" ? (
              <Video className="size-4" />
            ) : (
              <ImagePlus className="size-4" />
            )}
          </button>
        </PopoverTrigger>
        <p className="mt-1 truncate text-center text-[10px] text-muted-foreground" title={label}>
          {label}
        </p>
      </div>
      <PopoverContent side="top" align="start" className="w-[min(20rem,calc(100vw-2rem))]">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <input
          ref={fileRef}
          type="file"
          accept={kind === "video" ? "video/mp4,video/quicktime,video/webm,video/*" : "image/*"}
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
          Upload from device
        </Button>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^https?:\/\/\S+$/i.test(link.trim())) void choose(link.trim());
            else toast.error("Paste a full https:// link.");
          }}
        >
          <Input
            placeholder="or paste a link…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            className="h-8 flex-1"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!link.trim()}>
            Add
          </Button>
        </form>
        {picks.length > 0 && (
          <>
            <p className="pt-1 text-xs font-medium text-muted-foreground">From your generations</p>
            <div className="grid grid-cols-4 gap-1.5">
              {picks.map((g) => (
                <button
                  key={g._id}
                  type="button"
                  onClick={() => void choose(g.resultUrl!)}
                  className="aspect-square overflow-hidden rounded-md border border-border transition-colors hover:border-primary/60"
                  title={g.prompt}
                >
                  {kind === "video" ? (
                    <video src={`${g.resultUrl}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.resultUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Gallery                                                              */
/* ------------------------------------------------------------------ */

function tileRatio(g: Doc<"generations">): string {
  const ratio = (g.params?.options?.aspect_ratio as string | undefined) ?? "";
  const [w, h] = ratio.split(":").map(Number);
  return w && h ? `${w} / ${h}` : isVideoGen(g) ? "16 / 9" : "1 / 1";
}

function GalleryTile({
  g,
  onOpen,
  onCancel,
  canceling,
}: {
  g: Doc<"generations">;
  onOpen: () => void;
  onCancel: () => void;
  canceling: boolean;
}) {
  const busy = g.status === "pending" || g.status === "running";
  const label = findStudioModel(g.model)?.label ?? g.model;

  if (busy || g.status === "failed" || !g.resultUrl) {
    return (
      <div
        className="relative h-44 max-w-full overflow-hidden rounded-lg border border-border bg-secondary/40 sm:h-64"
        style={{ aspectRatio: tileRatio(g) }}
      >
        {busy && (
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-primary/10 via-transparent to-primary/5" />
        )}
        <div className="relative flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
          {busy ? (
            <Loader2 className="size-5 animate-spin text-primary" />
          ) : (
            <AlertTriangle className="size-5 text-muted-foreground" />
          )}
          <p className="text-xs font-medium">
            {busy ? (g.status === "pending" ? "Queuing…" : "Rendering…") : "Failed — credits refunded"}
          </p>
          <p className="line-clamp-2 max-w-[14rem] text-[11px] text-muted-foreground">{g.prompt}</p>
          {g.status === "pending" && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={canceling} onClick={onCancel}>
              {canceling ? <Loader2 className="size-3.5 animate-spin" /> : "Cancel"}
            </Button>
          )}
        </div>
        <span className="absolute bottom-1.5 left-2 text-[10px] text-muted-foreground">{label}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative h-44 max-w-full overflow-hidden rounded-lg border border-border bg-secondary transition-colors hover:border-primary/50 sm:h-64"
      style={{ aspectRatio: tileRatio(g) }}
      aria-label={`Open ${g.prompt}`}
    >
      {isVideoGen(g) ? (
        <video
          src={`${g.resultUrl}#t=0.1`}
          muted
          loop
          playsInline
          preload="metadata"
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => e.currentTarget.pause()}
          className="h-full w-full object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={g.resultUrl} alt={g.prompt} className="h-full w-full object-cover" />
      )}
      {isVideoGen(g) && (
        <span className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-white">
          <Clapperboard className="size-3.5" />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-6 text-left text-[11px] text-white/90 opacity-0 transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* The tab                                                              */
/* ------------------------------------------------------------------ */

/** Setup mode (no Convex provider): Studio generation needs Convex. */
export function StudioTab() {
  if (!hasConvex) {
    return (
      <Card className="border-white/10">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Clapperboard className="size-8 text-muted-foreground" />
          <p className="font-medium">Studio</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Studio generation needs Convex — preview-only until it is connected.
          </p>
        </CardContent>
      </Card>
    );
  }
  return <StudioTabLive />;
}

function StudioTabLive() {
  const pricing = useQuery(api.generations.pricing);
  const generationsQuery = useQuery(api.generations.list);
  const generate = useAction(api.studioActions.generate);
  const estimateCost = useAction(api.studioActions.estimateCost);
  const cancel = useAction(api.studioActions.cancelGeneration);
  const upload = useUploader();

  const allGenerations = useMemo(() => generationsQuery ?? [], [generationsQuery]);
  const studioGenerations = useMemo(
    () => allGenerations.filter((g) => g.provider === "higgsfield"),
    [allGenerations],
  );

  const [modelId, setModelId] = useState(STUDIO_MODELS[0].id);
  const model = findStudioModel(modelId)!;
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<Record<string, string | boolean>>(() =>
    defaultOptions(STUDIO_MODELS[0]),
  );
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [startImage, setStartImage] = useState("");
  const [endImage, setEndImage] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoSec, setVideoSec] = useState<number | null>(null);
  const [duration, setDuration] = useState<number>(STUDIO_MODELS[0].duration?.default ?? 5);
  const [batch, setBatch] = useState(1);
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState<Id<"generations"> | null>(null);
  const [openId, setOpenId] = useState<Id<"generations"> | null>(null);
  const [quickUploading, setQuickUploading] = useState(false);
  const quickFileRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // Each quote remembers the exact request it priced; a stale one simply
  // stops matching once the form changes.
  const [quote, setQuote] = useState<{ key: string; credits: number; exact: boolean } | null>(
    null,
  );

  const pickModel = (id: string) => {
    const next = findStudioModel(id)!;
    setModelId(id);
    setOptions(defaultOptions(next));
    setDuration(next.duration?.default ?? 5);
    setBatch(1);
  };

  const setOption = (key: string, next: string | boolean | undefined) =>
    setOptions((current) => {
      const copy = { ...current };
      if (next === undefined) delete copy[key];
      else copy[key] = next;
      return copy;
    });

  // What the server will receive — also drives the live quote.
  const request = useMemo(
    () => ({
      modelId,
      prompt,
      options,
      imageUrls: model.images ? imageUrls : [startImage, endImage].filter(Boolean),
      videoUrl: videoUrl || undefined,
      durationSec: model.video ? (videoSec ?? undefined) : duration,
      batch,
    }),
    [modelId, prompt, options, imageUrls, startImage, endImage, videoUrl, videoSec, duration, batch, model.images, model.video],
  );

  // Is the form complete enough to price / send? (Same rules as the server.)
  const validation = useMemo(() => {
    try {
      normalizeStudioInput(model, request);
      if (model.video && !videoSec) return "Waiting for the video's length…";
      return null;
    } catch (e) {
      return errorText(e, "Incomplete");
    }
  }, [model, request, videoSec]);

  const listCredits = useMemo(() => {
    if (!pricing) return 0;
    try {
      const input = normalizeStudioInput(model, request);
      return studioCreditsFromUsd({
        baseUsd: tokenMeteredUsd(model, input) ?? studioListUsd(model, input),
        markup: pricing.markup,
        creditPriceUsd: pricing.creditPriceUsd,
      });
    } catch {
      return 0;
    }
  }, [model, request, pricing]);

  // Exact quote from Higgsfield once the form is valid (debounced).
  const requestKey = useMemo(() => JSON.stringify(request), [request]);
  const debouncedRequest = useDebounced(request, 600);
  useEffect(() => {
    const key = JSON.stringify(debouncedRequest);
    // Only quote once the debounce has caught up with what `validation` checked.
    if (validation || key !== requestKey) return;
    let cancelled = false;
    estimateCost(debouncedRequest)
      .then((result) => {
        if (!cancelled) setQuote({ key, credits: result.credits, exact: result.exact });
      })
      .catch(() => {
        // Keep whatever we had; the list price covers the display.
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedRequest, requestKey, validation, estimateCost]);
  const liveQuote = quote && quote.key === requestKey ? quote : null;
  const credits = liveQuote?.credits ?? listCredits;

  const takesImages = Boolean(model.images || model.image);

  /** Drops a reference into the next free slot the current model has. */
  const addReference = (url: string, kind: "image" | "video", seconds?: number | null): boolean => {
    if (kind === "video") {
      if (!model.video) {
        toast.error(`${model.label} doesn't take a source video — pick a Genjutsu or Motion model.`);
        return false;
      }
      setVideoUrl(url);
      setVideoSec(seconds ?? null);
      if (seconds == null) void probeVideoDuration(url).then(setVideoSec);
      return true;
    }
    if (model.images) {
      if (imageUrls.length >= model.images.max) {
        toast.error(`${model.label} takes up to ${model.images.max} images.`);
        return false;
      }
      setImageUrls((current) => [...current, url]);
      return true;
    }
    if (model.image) {
      if (startImage && model.endImage && !endImage) setEndImage(url);
      else setStartImage(url);
      return true;
    }
    toast.error(`${model.label} works from text only — pick an image-to-video model to use a reference.`);
    return false;
  };

  const quickUpload = async (file: File) => {
    setQuickUploading(true);
    try {
      addReference(await upload(file), "image");
    } catch {
      toast.error("Upload failed — try again or paste a link.");
    } finally {
      setQuickUploading(false);
      if (quickFileRef.current) quickFileRef.current.value = "";
    }
  };

  const run = async () => {
    if (validation) {
      toast.error(validation);
      return;
    }
    setBusy(true);
    try {
      await generate(request);
      toast.success(
        model.output === "image"
          ? "Queued — your image appears above in a minute or so."
          : "Queued — rendering usually takes a few minutes; it appears above.",
      );
      if (model.prompt === "required") setPrompt("");
    } catch (e) {
      const message = e instanceof Error ? errorText(e, "") ?? "" : "";
      if (/first$|at least|source video|Unknown model|can't be canceled/.test(message)) {
        toast.error(message);
      } else {
        handleGenerateError(e);
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelJob = async (id: Id<"generations">) => {
    setCanceling(id);
    try {
      await cancel({ generationId: id });
      toast.success("Canceled — credits refunded.");
    } catch (e) {
      toast.error(e instanceof Error ? errorText(e, "") : "Couldn't cancel.");
    } finally {
      setCanceling(null);
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

  const open = studioGenerations.find((g) => g._id === openId) ?? null;
  const aspectField = model.fields.find(
    (f): f is Extract<StudioField, { type: "select" }> => f.key === "aspect_ratio" && f.type === "select",
  );
  const resolutionField = model.fields.find(
    (f): f is Extract<StudioField, { type: "select" }> => f.key === "resolution" && f.type === "select",
  );
  const otherFields = model.fields.filter((f) => !CHIP_KEYS.has(f.key) || f.type !== "select");
  const batchIndex = model.batch ? model.batch.options.indexOf(batch) : -1;
  const hasMedia = Boolean(model.image || model.images || model.video);

  return (
    <div className="flex min-h-[calc(100dvh-15rem)] flex-col">
      {/* Gallery */}
      <div className="flex-1 pb-6">
        {generationsQuery === undefined ? (
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-44 w-40 animate-pulse rounded-lg bg-secondary/50 sm:h-64 sm:w-56" />
            ))}
          </div>
        ) : studioGenerations.length === 0 ? (
          <div className="flex min-h-[38dvh] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
              <Sparkles className="size-5 text-primary" />
            </span>
            <p className="font-medium">Your Studio renders appear here</p>
            <p className="max-w-sm px-4 text-sm text-muted-foreground">
              Pick a model below, describe the shot and hit Generate. Everything also lands in your Library.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {studioGenerations.map((g) => (
              <GalleryTile
                key={g._id}
                g={g}
                onOpen={() => setOpenId(g._id)}
                onCancel={() => void cancelJob(g._id)}
                canceling={canceling === g._id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="sticky bottom-3 z-20 mx-auto w-full max-w-4xl">
        <div className="rounded-2xl border border-border bg-card/95 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-4">
          {hasMedia && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {model.image && (
                <MediaSlot
                  kind="image"
                  label={model.image.required ? "Start image" : "Image"}
                  value={startImage}
                  generations={allGenerations}
                  onChange={(url) => setStartImage(url)}
                />
              )}
              {model.endImage && (
                <MediaSlot
                  kind="image"
                  label="End frame"
                  value={endImage}
                  generations={allGenerations}
                  onChange={(url) => setEndImage(url)}
                />
              )}
              {model.video && (
                <MediaSlot
                  kind="video"
                  label="Source video"
                  value={videoUrl}
                  caption={videoSec ? `${Math.ceil(videoSec)} s video` : "Video"}
                  generations={allGenerations}
                  onChange={(url, seconds) => {
                    setVideoUrl(url);
                    setVideoSec(seconds ?? null);
                  }}
                />
              )}
              {model.images && (
                <>
                  {imageUrls.map((url, index) => (
                    <MediaSlot
                      key={`${index}-${url}`}
                      kind="image"
                      label={`Reference ${index + 1}`}
                      value={url}
                      generations={allGenerations}
                      onChange={(next) =>
                        setImageUrls((current) =>
                          next ? current.map((u, i) => (i === index ? next : u)) : current.filter((_, i) => i !== index),
                        )
                      }
                    />
                  ))}
                  {imageUrls.length < model.images.max && (
                    <MediaSlot
                      kind="image"
                      label={
                        model.images.min > 0 && imageUrls.length < model.images.min
                          ? `Add image (${imageUrls.length}/${model.images.max})`
                          : `Add (${imageUrls.length}/${model.images.max})`
                      }
                      value=""
                      generations={allGenerations}
                      onChange={(url) => url && setImageUrls((current) => [...current, url])}
                    />
                  )}
                </>
              )}
            </div>
          )}

          <textarea
            ref={promptRef}
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void run();
              }
            }}
            placeholder={
              model.family === "genjutsu"
                ? "Optional — e.g. 'keep the background, swap the jacket for the reference'"
                : model.output === "image"
                  ? "Describe the image — editorial portrait in soft daylight, 35mm, muted tones…"
                  : "Describe the shot — slow dolly-in on a rain-soaked street at night, neon reflections…"
            }
            aria-label="Prompt"
            className="field-sizing-content max-h-48 min-h-14 w-full resize-none bg-transparent px-1 py-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {takesImages && (
                <>
                  <input
                    ref={quickFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && void quickUpload(e.target.files[0])}
                  />
                  <button
                    type="button"
                    className={cn(chipClass, "px-2.5")}
                    onClick={() => quickFileRef.current?.click()}
                    disabled={quickUploading}
                    aria-label="Upload a reference image"
                    title="Upload a reference image"
                  >
                    {quickUploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  </button>
                </>
              )}
              <ModelPicker model={model} onPick={pickModel} />
              {aspectField && (
                <OptionChip
                  field={aspectField}
                  value={options.aspect_ratio as string | undefined}
                  onChange={(next) => setOption("aspect_ratio", next)}
                />
              )}
              {resolutionField && (
                <OptionChip
                  field={resolutionField}
                  value={options.resolution as string | undefined}
                  onChange={(next) => setOption("resolution", next)}
                />
              )}
              {model.duration && (
                <Stepper
                  label="Length"
                  icon={<Timer className="size-3.5 text-muted-foreground" />}
                  display={`${duration}s`}
                  canDec={duration > model.duration.min}
                  canInc={duration < model.duration.max}
                  onDec={() => setDuration((d) => Math.max(model.duration!.min, d - 1))}
                  onInc={() => setDuration((d) => Math.min(model.duration!.max, d + 1))}
                />
              )}
              {model.batch && (
                <Stepper
                  label="Images"
                  display={`${batch}/${model.batch.options[model.batch.options.length - 1]}`}
                  canDec={batchIndex > 0}
                  canInc={batchIndex < model.batch.options.length - 1}
                  onDec={() => setBatch(model.batch!.options[Math.max(0, batchIndex - 1)])}
                  onInc={() =>
                    setBatch(model.batch!.options[Math.min(model.batch!.options.length - 1, batchIndex + 1)])
                  }
                />
              )}
              {otherFields.length > 0 && (
                <SettingsChip fields={otherFields} options={options} onChange={setOption} />
              )}
              <EnhanceButton kind={model.output} prompt={prompt} onEnhanced={setPrompt} />
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-1">
              <Button
                onClick={() => void run()}
                disabled={busy || Boolean(validation)}
                title={validation ?? "Generate (Ctrl/⌘ + Enter)"}
                className="h-14 min-w-40 flex-col gap-0.5 rounded-xl px-6 text-base font-semibold"
              >
                <span className="flex items-center gap-1.5">
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : model.family === "genjutsu" ? (
                    <Wand2 className="size-4" />
                  ) : model.output === "image" ? (
                    <Sparkles className="size-4" />
                  ) : (
                    <Clapperboard className="size-4" />
                  )}
                  Generate
                </span>
                <span className="flex items-center gap-1 text-[11px] font-medium opacity-80">
                  <Coins className="size-3" />
                  {credits.toLocaleString()} credits
                </span>
              </Button>
              <p className="text-center text-[10px] text-muted-foreground">
                {validation ?? (liveQuote?.exact ? "exact quote" : "list price — exact quote loading…")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Preview */}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="line-clamp-2 pr-6 text-base font-medium">{open?.prompt}</DialogTitle>
            <DialogDescription>
              {open &&
                `${findStudioModel(open.model)?.label ?? open.model} · ${open.costCredits} credits · ${new Date(open._creationTime).toLocaleString()}`}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {open?.resultUrl &&
              (isVideoGen(open) ? (
                <video
                  src={open.resultUrl}
                  controls
                  autoPlay
                  className="max-h-[55dvh] w-full rounded-lg bg-black object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={open.resultUrl} alt={open.prompt} className="max-h-[55dvh] w-full rounded-lg object-contain" />
              ))}
          </div>
          {open?.resultUrl && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button
                onClick={() => {
                  if (addReference(open.resultUrl!, isVideoGen(open) ? "video" : "image")) {
                    setOpenId(null);
                    toast.success("Added as a reference.");
                  }
                }}
              >
                <ImagePlus className="size-4" /> Use as reference
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (findStudioModel(open.model)) pickModel(open.model);
                  setPrompt(open.prompt);
                  setOpenId(null);
                  promptRef.current?.focus();
                }}
              >
                <RotateCcw className="size-4" /> Reuse prompt
              </Button>
              <Button variant="outline" onClick={() => void copy(open.prompt, "Prompt")}>
                <ClipboardCopy className="size-4" /> Copy prompt
              </Button>
              <Button variant="outline" onClick={() => void copy(open.resultUrl!, "Link")}>
                <LinkIcon className="size-4" /> Copy link
              </Button>
              <Button variant="outline" onClick={() => window.open(open.resultUrl!, "_blank", "noopener")}>
                <ExternalLink className="size-4" /> Full size
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
