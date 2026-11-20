"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { friendlyError } from "./shared";

export const FOLDER_COLORS = [
  "#8b5cf6",
  "#ec4899",
  "#10b981",
  "#0ea5e9",
  "#f59e0b",
  "#ef4444",
  "#64748b",
];

export type FolderInput = {
  _id: Id<"noteFolders">;
  name: string;
  color: string | null;
  rules: { titleContains: string[]; emailDomains: string[] };
};

/** Create or edit a custom folder, with optional auto-filing rules. */
export function FolderDialog({
  open,
  onOpenChange,
  folder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = new folder. */
  folder: FolderInput | null;
}) {
  const save = useMutation(api.noteTaker.saveFolder);
  const remove = useMutation(api.noteTaker.deleteFolder);
  const [name, setName] = useState("");
  const [color, setColor] = useState(FOLDER_COLORS[0]);
  const [words, setWords] = useState("");
  const [domains, setDomains] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);

  // Re-seed the form each time it opens (for a new or a different folder).
  const seedKey = open ? (folder?._id ?? "new") : null;
  if (seedKey !== seeded) {
    setSeeded(seedKey);
    if (seedKey) {
      setName(folder?.name ?? "");
      setColor(folder?.color ?? FOLDER_COLORS[0]);
      setWords(folder?.rules.titleContains.join(", ") ?? "");
      setDomains(folder?.rules.emailDomains.join(", ") ?? "");
    }
  }

  const split = (text: string) =>
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const doSave = async () => {
    setBusy("save");
    try {
      await save({
        folderId: folder?._id,
        name,
        color,
        rules: { titleContains: split(words), emailDomains: split(domains) },
      });
      toast.success(folder ? "Folder updated." : "Folder created.");
      onOpenChange(false);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't save the folder."));
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    if (!folder) return;
    setBusy("delete");
    try {
      await remove({ folderId: folder._id });
      toast.success("Folder deleted — the meetings in it are kept.");
      onOpenChange(false);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't delete the folder."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{folder ? "Edit folder" : "New folder"}</DialogTitle>
          <DialogDescription>
            Group meetings by client, project or team. Rules file new meetings
            in automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme account"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <div className="flex gap-2">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-6 rounded-full ring-offset-2 ring-offset-background transition",
                    color === c && "ring-2 ring-foreground",
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="folder-words">Title contains (optional)</Label>
            <Input
              id="folder-words"
              value={words}
              onChange={(e) => setWords(e.target.value)}
              placeholder="Acme, onboarding"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="folder-domains">A guest&apos;s email is from (optional)</Label>
            <Input
              id="folder-domains"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="acme.com"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated. Matching meetings from the past few hundred are
              filed now; new ones as their notes are written.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {folder ? (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={busy !== null}
              onClick={() => void doDelete()}
            >
              {busy === "delete" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => void doSave()} disabled={busy !== null || !name.trim()}>
            {busy === "save" && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
