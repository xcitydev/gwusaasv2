"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { AtSign, GraduationCap, Loader2, MapPin, Package, Pencil, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { errorText } from "@/lib/public-errors";
import type { IncomingReference } from "./studio-tab";
import { TrainCharacterDialog } from "./train-character-dialog";
import { ElementDialog, type ElementDialogTarget } from "./element-dialog";

type Kind = "character" | "location" | "prop";
const KINDS: { value: Kind; label: string; icon: typeof UserRound }[] = [
  { value: "character", label: "Characters", icon: UserRound },
  { value: "location", label: "Locations", icon: MapPin },
  { value: "prop", label: "Props", icon: Package },
];

/**
 * Saved elements — people, places and objects (AI Influencer sheets, saved
 * renders, uploads, trained faces). Type @handle in any prompt to use one,
 * or send it straight to Studio.
 */
export function CharactersTab({
  onUse,
  onCreateInfluencer,
}: {
  onUse: (ref: Omit<IncomingReference, "nonce">) => void;
  onCreateInfluencer: () => void;
}) {
  const characters = useQuery(api.characters.list);
  const [filter, setFilter] = useState<Kind | "all">("all");
  const remove = useMutation(api.characters.remove);
  const [dialog, setDialog] = useState<ElementDialogTarget | null>(null);
  const [deleting, setDeleting] = useState<Id<"characters"> | null>(null);
  const [training, setTraining] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Your saved people, places and props. Type <span className="font-medium text-foreground">@</span> in any prompt to drop one in — the same face, room or product every time.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setDialog({ mode: "create", kind: filter === "all" ? "character" : filter })}
          >
            <Plus className="size-4" /> New element
          </Button>
          <Button variant="outline" onClick={onCreateInfluencer}>
            <Sparkles className="size-4" /> Create an influencer
          </Button>
          <Button onClick={() => setTraining(true)}>
            <GraduationCap className="size-4" /> Train a character
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {[{ value: "all" as const, label: "All", icon: AtSign }, ...KINDS].map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setFilter(k.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors",
              filter === k.value
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <k.icon className="size-3.5" /> {k.label}
          </button>
        ))}
      </div>

      {characters === undefined ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-secondary/50" />
          ))}
        </div>
      ) : characters.filter((c) => filter === "all" || (c.kind ?? "character") === filter).length === 0 ? (
        <div className="flex min-h-[38dvh] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
            <UserRound className="size-5 text-primary" />
          </span>
          <p className="font-medium">Nothing saved here yet</p>
          <p className="max-w-sm px-4 text-sm text-muted-foreground">
            Upload a photo, create an AI influencer, or open any image you generated and choose “Save as element”.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {characters.filter((c) => filter === "all" || (c.kind ?? "character") === filter).map((c) => (
            <div key={c._id} className="group overflow-hidden rounded-xl border border-border bg-card">
              <button
                type="button"
                onClick={() => setDialog({ mode: "edit", element: c })}
                className="relative block aspect-[3/4] w-full bg-secondary text-left"
                aria-label={`Edit ${c.name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageUrl} alt={c.name} className="h-full w-full object-cover" />
                {(c.extraImageUrls?.length ?? 0) > 0 && (
                  <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    +{c.extraImageUrls!.length} angle{c.extraImageUrls!.length === 1 ? "" : "s"}
                  </span>
                )}
                <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  {c.soul ? "Trained" : c.source === "influencer" ? "AI influencer" : c.source === "upload" ? "Photo" : "Render"}
                </span>
                {c.soul?.status === "training" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-center text-white">
                    <Loader2 className="size-5 animate-spin" />
                    <span className="px-3 text-xs">Training… usually a few minutes</span>
                  </div>
                )}
                {c.soul?.status === "failed" && (
                  <div className="absolute inset-x-0 bottom-0 bg-destructive/85 px-2 py-1 text-[11px] text-white" title={c.soul.error}>
                    Training failed — credits refunded
                  </div>
                )}
              </button>
              <div className="space-y-2 p-2.5">
                <div className="flex min-w-0 items-start gap-1.5">
                  {(() => {
                    const K = KINDS.find((k) => k.value === (c.kind ?? "character"))!;
                    return <K.icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label={K.label} />;
                  })()}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={c.name}>{c.name}</p>
                    <p className="truncate text-xs text-primary">@{c.handle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    disabled={c.soul?.status === "training"}
                    onClick={() =>
                      onUse(
                        c.soul?.status === "ready" && c.soul.refId
                          ? { url: c.imageUrl, soulRefId: c.soul.refId, soulVersion: c.soul.version }
                          : { url: c.imageUrl },
                      )
                    }
                  >
                    Use in Studio
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`Edit ${c.name}`}
                    onClick={() => setDialog({ mode: "edit", element: c })}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => setDeleting(c._id)}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <TrainCharacterDialog open={training} onOpenChange={setTraining} />
      <ElementDialog target={dialog} onClose={() => setDialog(null)} />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this character?</AlertDialogTitle>
            <AlertDialogDescription>
              It&apos;s removed from your Elements. Images you already made with it stay in your Library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleting) return;
                try {
                  await remove({ id: deleting });
                  setDeleting(null);
                } catch (e) {
                  toast.error(errorText(e, "Delete failed."));
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
