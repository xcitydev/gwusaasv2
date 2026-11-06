"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Sparkles, Video } from "lucide-react";
import { RecordDialog } from "./record-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AskPanel } from "./ask-panel";

/**
 * "Add to live meeting" — paste a link from anywhere in the app and the
 * note taker joins (Read.ai's sidebar button). Shown once the note taker is
 * switched on for the platform.
 */
export function LiveMeetingButton() {
  const router = useRouter();
  const overview = useQuery(api.noteTaker.overview);
  if (!overview?.configured) return null;
  return (
    <RecordDialog
      overview={overview}
      onSent={(id) => router.push(`/note-taker?meeting=${id}`)}
      trigger={
        <Button variant="outline" size="sm" className="gap-1.5" aria-label="Add the note taker to a live meeting">
          <Video className="size-4 text-primary" />
          <span className="hidden xl:inline">Add to live meeting</span>
        </Button>
      }
    />
  );
}

/**
 * The "Ask your meetings…" bar in the global header — on every page. Opens a
 * side panel with the cross-meeting Ask; Ctrl/⌘ J opens it from anywhere.
 */
export function AskBar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "j") return;
      e.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Desktop: looks like a search box. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tour="notetaker-ask-bar"
        className="hidden h-9 w-full max-w-md items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-left text-sm text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground md:flex"
      >
        <Sparkles className="size-4 text-primary" />
        <span className="flex-1 truncate">Ask your meetings anything…</span>
        <kbd className="rounded border border-white/10 px-1.5 font-mono text-[10px]">Ctrl J</kbd>
      </button>
      {/* Mobile: an icon. */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Ask your meetings"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="size-5 text-primary" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-border">
            <SheetTitle>Ask your meetings</SheetTitle>
            <SheetDescription>
              Answers come from your meeting notes and transcripts, with links
              to the moment it was said.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 p-3">
            {open && <AskPanel compact onNavigate={() => setOpen(false)} />}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
