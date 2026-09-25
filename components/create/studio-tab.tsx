"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Clapperboard, Loader2, Plus, Sparkles, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import {
  STUDIO_FAMILIES,
  STUDIO_MODELS,
  findStudioModel,
  normalizeStudioInput,
  studioCreditsFromUsd,
  studioListUsd,
  tokenMeteredUsd,
  type StudioField,
  type StudioModel,
} from "@/lib/studio-models";
import { cn } from "@/lib/utils";
import {
  CostPill,
  DrivingVideoInput,
  EnhanceButton,
  ReferenceInput,
  handleGenerateError,
} from "./create-client";

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

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: StudioField;
  value: string | boolean | undefined;
  onChange: (next: string | boolean | undefined) => void;
}) {
  if (field.type === "toggle") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
        <div>
          <p className="text-sm">{field.label}</p>
          {field.helper && (
            <p className="text-xs text-muted-foreground">{field.helper}</p>
          )}
        </div>
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked)}
          aria-label={field.label}
        />
      </div>
    );
  }
  const AUTO = "__auto__";
  return (
    <div>
      <Label className="mb-1.5">{field.label}</Label>
      <Select
        value={typeof value === "string" ? value : field.optional ? AUTO : (field.default ?? "")}
        onValueChange={(next) => onChange(next === AUTO ? undefined : next)}
      >
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent className="max-h-72">
          {field.optional && <SelectItem value={AUTO}>Auto</SelectItem>}
          {field.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {field.helper && (
        <p className="mt-1 text-xs text-muted-foreground">{field.helper}</p>
      )}
    </div>
  );
}

/** Up to N reference images, each pasted or uploaded. */
function MultiImageInput({
  urls,
  max,
  helper,
  onChange,
}: {
  urls: string[];
  max: number;
  helper?: string;
  onChange: (urls: string[]) => void;
}) {
  const rows = urls.length === 0 ? [""] : urls;
  return (
    <div className="space-y-2">
      {rows.map((url, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <ReferenceInput
              value={url}
              onChange={(next) => {
                const copy = [...rows];
                copy[index] = next;
                onChange(copy.filter((u, i) => u.trim() || i === copy.length - 1));
              }}
            />
          </div>
          {rows.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              aria-label="Remove image"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between">
        {helper ? (
          <p className="text-xs text-muted-foreground">{helper}</p>
        ) : (
          <span />
        )}
        {rows.length < max && rows[rows.length - 1]?.trim() && (
          <Button variant="ghost" size="sm" onClick={() => onChange([...rows, ""])}>
            <Plus className="size-3.5" /> Add another ({rows.length}/{max})
          </Button>
        )}
      </div>
    </div>
  );
}

/** Studio jobs still in flight — live, with cancel while queued. */
function ActiveJobs() {
  const generations = useQuery(api.generations.list) ?? [];
  const cancel = useAction(api.studioActions.cancelGeneration);
  const [busy, setBusy] = useState<Id<"generations"> | null>(null);
  const active = generations.filter(
    (g) => g.provider === "higgsfield" && (g.status === "pending" || g.status === "running"),
  );
  if (active.length === 0) return null;
  return (
    <Card className="border-primary/20">
      <CardContent className="divide-y divide-border p-0">
        {active.map((g) => (
          <div key={g._id} className="flex items-center gap-3 px-4 py-2.5">
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{g.prompt}</p>
              <p className="text-xs text-muted-foreground">
                {findStudioModel(g.model)?.label ?? g.model} · {g.costCredits} credits ·{" "}
                {g.status === "pending" ? "queuing" : "rendering"} — it lands in your Library when done
              </p>
            </div>
            <StatusBadge status={g.status} />
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(g._id);
                try {
                  await cancel({ generationId: g._id });
                  toast.success("Canceled — credits refunded.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message.split("Uncaught Error: ").pop() : "Couldn't cancel.");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === g._id ? <Loader2 className="size-4 animate-spin" /> : "Cancel"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function StudioTab() {
  const pricing = useQuery(api.generations.pricing);
  const generate = useAction(api.studioActions.generate);
  const estimateCost = useAction(api.studioActions.estimateCost);

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
      return e instanceof Error ? e.message : "Incomplete";
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
    if (validation) return;
    let cancelled = false;
    const key = JSON.stringify(debouncedRequest);
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
  }, [debouncedRequest, validation, estimateCost]);
  const liveQuote = quote && quote.key === requestKey ? quote : null;

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
          ? "Queued — your image lands in the Library in a minute or so."
          : "Queued — rendering usually takes a few minutes; it lands in your Library.",
      );
      if (model.prompt === "required") setPrompt("");
    } catch (e) {
      const message = e instanceof Error ? e.message.split("Uncaught Error: ").pop() ?? "" : "";
      if (/first$|at least|source video|Unknown model|can't be canceled/.test(message)) {
        toast.error(message);
      } else {
        handleGenerateError(e);
      }
    } finally {
      setBusy(false);
    }
  };

  const credits = liveQuote?.credits ?? listCredits;

  return (
    <div className="space-y-4">
      <ActiveJobs />
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <Label className="mb-1.5">Model</Label>
              <Select value={modelId} onValueChange={pickModel}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STUDIO_FAMILIES.map((family) => (
                    <SelectGroup key={family.value}>
                      <SelectLabel>{family.label}</SelectLabel>
                      {STUDIO_MODELS.filter((m) => m.family === family.value).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-xs text-muted-foreground">{model.tagline}</p>
            </div>
            {model.batch && (
              <div>
                <Label className="mb-1.5">Images</Label>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary/60 p-1">
                  {model.batch.options.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setBatch(n)}
                      className={cn(
                        "rounded-md px-4 py-1.5 text-sm transition-colors",
                        batch === n
                          ? "bg-background font-medium text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      ×{n}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {(model.image || model.images || model.video) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {model.image && (
                <div>
                  <Label className="mb-1.5">{model.image.label}</Label>
                  <ReferenceInput
                    value={startImage}
                    onChange={setStartImage}
                    helper={model.image.helper ?? "Upload or paste a link."}
                  />
                </div>
              )}
              {model.endImage && (
                <div>
                  <Label className="mb-1.5">{model.endImage.label}</Label>
                  <ReferenceInput
                    value={endImage}
                    onChange={setEndImage}
                    helper="Where the clip should end up."
                  />
                </div>
              )}
              {model.video && (
                <div>
                  <Label className="mb-1.5">{model.video.label}</Label>
                  <DrivingVideoInput
                    value={videoUrl}
                    durationSec={videoSec}
                    onChange={(url, seconds) => {
                      setVideoUrl(url);
                      setVideoSec(seconds);
                    }}
                  />
                  {model.video.helper && videoUrl && (
                    <p className="mt-1 text-xs text-muted-foreground">{model.video.helper}</p>
                  )}
                </div>
              )}
              {model.images && (
                <div className={cn(!model.video && "sm:col-span-2")}>
                  <Label className="mb-1.5">{model.images.label}</Label>
                  <MultiImageInput
                    urls={imageUrls}
                    max={model.images.max}
                    helper={model.images.helper}
                    onChange={setImageUrls}
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label>Prompt{model.prompt === "optional" ? " (optional)" : ""}</Label>
              <EnhanceButton kind={model.output} prompt={prompt} onEnhanced={setPrompt} />
            </div>
            <Textarea
              rows={3}
              placeholder={
                model.family === "genjutsu"
                  ? "Optional — e.g. 'keep the background, swap the jacket for the reference'"
                  : model.output === "image"
                    ? "Editorial portrait in soft daylight, 35mm, muted tones…"
                    : "Slow dolly-in on a rain-soaked street at night, neon reflections…"
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {model.duration && (
              <div>
                <Label className="mb-1.5">Length (seconds)</Label>
                <Input
                  type="number"
                  min={model.duration.min}
                  max={model.duration.max}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  onBlur={() =>
                    setDuration((d) =>
                      Math.min(model.duration!.max, Math.max(model.duration!.min, Math.round(d) || model.duration!.default)),
                    )
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {model.duration.min}–{model.duration.max} s
                </p>
              </div>
            )}
            {model.fields.map((field) => (
              <FieldControl
                key={field.key}
                field={field}
                value={options[field.key]}
                onChange={(next) =>
                  setOptions((current) => {
                    const copy = { ...current };
                    if (next === undefined) delete copy[field.key];
                    else copy[field.key] = next;
                    return copy;
                  })
                }
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CostPill credits={credits} />
              <span className="text-xs text-muted-foreground">
                {liveQuote?.exact
                  ? "exact quote"
                  : validation
                    ? validation
                    : "list price — exact quote loading…"}
              </span>
            </div>
            <Button onClick={run} disabled={busy || Boolean(validation)}>
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
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
