"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { AtSign, ImagePlus, Loader2, MapPin, Package, Plus, Trash2, Upload, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/public-errors";
import { useUploader } from "./use-uploader";

type Kind = "character" | "location" | "prop";
const KINDS: { value: Kind; label: string; icon: typeof UserRound; hint: string }[] = [
  { value: "character", label: "Character", icon: UserRound, hint: "A person, mascot or model" },
  { value: "location", label: "Location", icon: MapPin, hint: "A place, set or background" },
  { value: "prop", label: "Prop", icon: Package, hint: "A product or object" },
];
const MAX_IMAGES = 5;

/** Same rule as the server: "Dre's Café" → "dres-cafe". */
function toHandle(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || ""
  );
}

export type ElementDialogTarget =
  | { mode: "create"; imageUrl?: string; generationId?: Id<"generations">; name?: string; kind?: Kind; traits?: unknown }
  | { mode: "edit"; element: Doc<"characters"> & { handle: string } };

/**
 * New / edit element: big preview on the left, details on the right
 * (category, name, @Element ID, description). Mirrors how Higgsfield does it.
 */
export function ElementDialog({
  target,
  onClose,
}: {
  target: ElementDialogTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      {target && (
        <ElementDialogBody
          // Fresh form for every element opened.
          key={target.mode === "edit" ? target.element._id : (target.generationId ?? target.imageUrl ?? "new")}
          target={target}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function ElementDialogBody({ target, onClose }: { target: ElementDialogTarget; onClose: () => void }) {
  const create = useMutation(api.characters.create);
  const update = useMutation(api.characters.update);
  const upload = useUploader();
  const fileRef = useRef<HTMLInputElement>(null);
  const editing = target.mode === "edit" ? target.element : null;

  const [images, setImages] = useState<string[]>(() =>
    editing
      ? [editing.imageUrl, ...(editing.extraImageUrls ?? [])]
      : target.mode === "create" && target.imageUrl
        ? [target.imageUrl]
        : [],
  );
  const [selected, setSelected] = useState(0);
  const [kind, setKind] = useState<Kind>(
    editing?.kind ?? (target.mode === "create" ? (target.kind ?? "character") : "character"),
  );
  const initialName = editing?.name ?? (target.mode === "create" ? (target.name ?? "") : "");
  const [name, setName] = useState(initialName);
  const [handle, setHandle] = useState(editing?.handle ?? toHandle(initialName));
  // The ID follows the name until the user edits it themselves.
  const [handleTouched, setHandleTouched] = useState(Boolean(editing));
  const [description, setDescription] = useState(editing?.description ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, MAX_IMAGES - images.length);
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const file of list) {
        const url = await upload(file);
        setImages((current) => {
          const next = [...current, url].slice(0, MAX_IMAGES);
          setSelected(next.length - 1);
          return next;
        });
        if (!name.trim()) {
          const fromFile = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60);
          setName(fromFile);
          if (!handleTouched) setHandle(toHandle(fromFile));
        }
      }
    } catch {
      toast.error("Upload failed — try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    setImages((current) => current.filter((_, i) => i !== index));
    setSelected(0);
  };

  const save = async () => {
    if (images.length === 0) {
      toast.error("Add an image first.");
      return;
    }
    setSaving(true);
    try {
      const [cover, ...extras] = images;
      if (editing) {
        await update({
          id: editing._id,
          name: name.trim() || editing.name,
          kind,
          handle,
          description,
          imageUrl: cover,
          extraImageUrls: extras,
        });
        toast.success("Element updated.");
      } else {
        const fromRender = target.mode === "create" && target.generationId && cover === target.imageUrl;
        await create({
          name: name.trim() || "My element",
          ...(fromRender ? { generationId: target.generationId } : { imageUrl: cover }),
          kind,
          handle: handle || undefined,
          description,
          extraImageUrls: extras,
          traits: target.mode === "create" ? target.traits : undefined,
        });
        toast.success(`Saved — type @${handle || toHandle(name) || "element"} in any prompt to use it.`);
      }
      onClose();
    } catch (e) {
      toast.error(errorText(e, "Couldn't save it."));
    } finally {
      setSaving(false);
    }
  };

  const current = images[selected];
  const kindInfo = KINDS.find((k) => k.value === kind)!;

  return (
    <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
      <div className="border-b px-5 py-4">
        <DialogTitle className="text-base">{editing ? "Edit element" : "New element"}</DialogTitle>
      </div>

      <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_22rem] md:overflow-hidden">
        {/* Preview */}
        <div
          className="flex min-h-0 flex-col gap-3 bg-secondary/30 p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && void addFiles(e.target.files)}
          />
          <div className="relative flex min-h-64 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black/40 md:min-h-[26rem]">
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current} alt={name || "Element"} className="max-h-[60dvh] w-full object-contain" />
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center gap-3 p-10 text-muted-foreground transition-colors hover:text-foreground"
              >
                <span className="flex size-14 items-center justify-center rounded-full border border-border bg-secondary">
                  {uploading ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" />}
                </span>
                <span className="text-sm font-medium">Upload from device</span>
                <span className="text-xs">or drop images here — up to {MAX_IMAGES} angles of the same {kindInfo.label.toLowerCase()}</span>
              </button>
            )}
          </div>
          {images.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2 overflow-x-auto">
                {images.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setSelected(i)}
                    className={cn(
                      "relative size-14 shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                      i === selected ? "border-primary" : "border-transparent opacity-70 hover:opacity-100",
                    )}
                    aria-label={i === 0 ? "Cover image" : `Angle ${i + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    {i === 0 && (
                      <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[9px] text-white">Cover</span>
                    )}
                  </button>
                ))}
                {images.length < MAX_IMAGES && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground"
                    aria-label="Add another angle"
                    title="Add another angle"
                  >
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  </button>
                )}
              </div>
              {!(editing?.soul && selected === 0) && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove this image"
                  onClick={() => removeImage(selected)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="space-y-5 border-t p-5 md:overflow-y-auto md:border-l md:border-t-0">
          <div>
            <p className="mb-1.5 text-sm font-medium">Category</p>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    <k.icon className="size-4" /> {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{kindInfo.hint}</p>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">Name</p>
            <Input
              value={name}
              maxLength={60}
              placeholder="e.g. Dre, Luna Rooftop, Gold Watch"
              onChange={(e) => {
                setName(e.target.value);
                if (!handleTouched) setHandle(toHandle(e.target.value));
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">The display name.</p>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">Element ID</p>
            <div className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
              <AtSign className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={handle}
                maxLength={32}
                onChange={(e) => {
                  setHandleTouched(true);
                  setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
                }}
                placeholder="my-element"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                aria-label="Element ID"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Type <span className="text-primary">@{handle || "my-element"}</span> in any prompt to use it.
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">Description</p>
            <Textarea
              rows={4}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                kind === "location"
                  ? "Optional — e.g. rooftop terrace, round yellow neon sign, ocean view"
                  : kind === "prop"
                    ? "Optional — e.g. matte black bottle, gold cap, logo on the front"
                    : "Optional — e.g. tall, short curly hair, always wears a grey suit"
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">Added to the prompt with the image so the model gets the details right.</p>
          </div>

          {editing?.soul && (
            <p className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs text-muted-foreground">
              <ImagePlus className="mr-1 inline size-3.5 text-primary" />
              Trained face — on Soul models it&apos;s used as a trained identity, not just a picture.
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t px-5 py-3">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={saving || uploading || images.length === 0 || !handle}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {editing ? "Save" : "Create"}
        </Button>
      </div>
    </DialogContent>
  );
}
