"use client";

import { useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Check, Coins, ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/public-errors";
import { handleGenerateError } from "./generate-helpers";
import { useUploader } from "./use-uploader";

const MIN = 3;
const MAX = 20;

const VERSIONS = [
  { value: "v2", label: "Soul 2", hint: "Photoreal, cheapest per image — best default" },
  { value: "v1", label: "Soul Standard", hint: "Editorial fashion looks" },
  { value: "cinema", label: "Soul Cinema", hint: "Film-style stills" },
] as const;

/**
 * "Make your own character": upload photos of one person, train once, then
 * reuse that face in every Soul image. Training runs in the background.
 */
export function TrainCharacterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const price = useQuery(api.characterTraining.trainingPrice);
  const train = useAction(api.characterTraining.train);
  const upload = useUploader();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState<(typeof VERSIONS)[number]["value"]>("v2");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);

  const addFiles = async (files: FileList) => {
    const room = MAX - photos.length;
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, room);
    if (files.length > room) toast.info(`Only the first ${room} were added — ${MAX} photos max.`);
    setUploading(list.length);
    for (const file of list) {
      try {
        const url = await upload(file);
        setPhotos((current) => [...current, url].slice(0, MAX));
      } catch {
        toast.error(`Couldn't upload ${file.name}.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const reset = () => {
    setName("");
    setPhotos([]);
    setVersion("v2");
  };

  const submit = async () => {
    setBusy(true);
    try {
      await train({ name: name.trim() || "My character", version, photoUrls: photos });
      toast.success("Training started — it takes a few minutes. You can keep working.");
      reset();
      onOpenChange(false);
    } catch (e) {
      const message = e instanceof Error ? errorText(e, "") ?? "" : "";
      if (/photos/.test(message)) toast.error(message);
      else handleGenerateError(e);
    } finally {
      setBusy(false);
    }
  };

  const ready = photos.length >= MIN && uploading === 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Make your own character</DialogTitle>
          <DialogDescription>
            Upload {MIN}–{MAX} photos of one person from different angles. We train their face once, then you can use the same person in any Soul image.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <p className="mb-1.5 text-xs font-medium">Name</p>
              <Input value={name} maxLength={60} placeholder="e.g. Maya, brand ambassador" onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium">Use it with</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {VERSIONS.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => setVersion(v.value)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    version === v.value ? "border-primary/60 bg-primary/10" : "border-border hover:border-primary/30",
                  )}
                >
                  <span className="block text-sm font-medium">{v.label}</span>
                  <span className="block text-xs text-muted-foreground">{v.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium">
                Photos <span className="font-normal text-muted-foreground">({photos.length}/{MAX}, at least {MIN})</span>
              </p>
              {photos.length > 0 && (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setPhotos([])}>
                  Clear all
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && void addFiles(e.target.files)}
            />
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {photos.map((url, i) => (
                <div key={url} className="relative aspect-square overflow-hidden rounded-lg border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPhotos((current) => current.filter((u) => u !== url))}
                    aria-label={`Remove photo ${i + 1}`}
                    className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5 text-white"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {Array.from({ length: uploading }, (_, i) => (
                <div key={`u${i}`} className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border">
                  <Loader2 className="size-4 animate-spin text-primary" />
                </div>
              ))}
              {photos.length + uploading < MAX && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  <ImagePlus className="size-5" />
                  <span className="text-[11px]">Add photos</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 rounded-xl border border-border p-3 text-xs sm:grid-cols-2">
            <div>
              <p className="mb-1 flex items-center gap-1.5 font-medium text-emerald-400"><Check className="size-3.5" /> Works best</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                <li>Just one person, face clearly visible</li>
                <li>Different angles, expressions and lighting</li>
                <li>Sharp, well-lit photos (10–20 is ideal)</li>
              </ul>
            </div>
            <div>
              <p className="mb-1 flex items-center gap-1.5 font-medium text-destructive"><X className="size-3.5" /> Avoid</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                <li>Group photos or other faces in frame</li>
                <li>Sunglasses, masks, heavy filters</li>
                <li>Blurry, tiny or very dark images</li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Only upload photos of yourself or someone who has agreed to it.</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Coins className="size-4 text-primary" />
            {price === undefined ? "…" : `${price.toLocaleString()} credits`} · one-time training
          </span>
          <Button onClick={() => void submit()} disabled={!ready}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {photos.length < MIN ? `Add ${MIN - photos.length} more photo${MIN - photos.length === 1 ? "" : "s"}` : "Train character"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
