"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { ChevronDown, FolderPlus, Folders, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  MEETING_TEMPLATES,
  MEETING_TYPES,
  isMeetingType,
  meetingTypeLabel,
} from "@/lib/meeting-templates";
import { FolderDialog } from "./folder-dialog";
import { FolderChip, friendlyError } from "./shared";

/**
 * Meeting type picker. Picking a different type locks it and rewrites the
 * notes with that type's template (sales → pain points, budget, …).
 */
export function TypePicker({ meeting }: { meeting: Doc<"meetings"> }) {
  const regenerate = useAction(api.noteTakerAi.regenerateNotes);
  const [busy, setBusy] = useState(false);
  const canRewrite = Boolean(meeting.finalizedAt) && meeting.notesStatus !== "pending";
  const current = isMeetingType(meeting.meetingType) ? meeting.meetingType : null;

  const pick = async (type: string) => {
    if (type === current) return;
    setBusy(true);
    try {
      await regenerate({ meetingId: meeting._id, meetingType: type });
      toast.success(`Rewriting the notes as a ${meetingTypeLabel(type)}…`);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't change the meeting type."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!canRewrite || busy}>
        <button
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none transition-opacity disabled:opacity-60",
            current ? MEETING_TEMPLATES[current].className : "bg-secondary text-muted-foreground",
          )}
          title={canRewrite ? "Meeting type — sets the notes template" : undefined}
        >
          {busy && <Loader2 className="size-3 animate-spin" />}
          {current ? MEETING_TEMPLATES[current].label : "Set type"}
          {canRewrite && <ChevronDown className="size-3" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Rewrite the notes with this template
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current ?? ""} onValueChange={(v) => void pick(v)}>
          {MEETING_TYPES.map((type) => (
            <DropdownMenuRadioItem key={type} value={type} className="flex-col items-start">
              <span className="text-sm">{MEETING_TEMPLATES[type].label}</span>
              <span className="text-xs text-muted-foreground">
                {MEETING_TEMPLATES[type].description}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The meeting's custom folders, plus a menu to file it / make a new folder. */
export function FolderMenu({ meeting }: { meeting: Doc<"meetings"> }) {
  const summary = useQuery(api.noteTaker.folderSummary);
  const setFolder = useMutation(api.noteTaker.setMeetingFolder);
  const [dialogOpen, setDialogOpen] = useState(false);
  const folders = summary?.folders ?? [];
  const inFolders = new Set(meeting.folderIds ?? []);

  return (
    <>
      {folders
        .filter((f) => inFolders.has(f._id))
        .map((folder) => (
          <FolderChip key={folder._id} name={folder.name} color={folder.color} />
        ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]">
            <Folders className="size-3.5" /> Folders
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {folders.length === 0 ? (
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              No folders yet
            </DropdownMenuLabel>
          ) : (
            folders.map((folder) => (
              <DropdownMenuCheckboxItem
                key={folder._id}
                checked={inFolders.has(folder._id)}
                onCheckedChange={async (checked) => {
                  try {
                    await setFolder({
                      meetingId: meeting._id,
                      folderId: folder._id,
                      inFolder: checked === true,
                    });
                  } catch (e) {
                    toast.error(friendlyError(e, "Couldn't update the folder."));
                  }
                }}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: folder.color ?? "currentColor" }}
                />
                {folder.name}
              </DropdownMenuCheckboxItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
            <FolderPlus className="size-4" /> New folder…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FolderDialog open={dialogOpen} folder={null} onOpenChange={setDialogOpen} />
    </>
  );
}
