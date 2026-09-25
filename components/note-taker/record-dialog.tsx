"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectPlatform, MEETING_PLATFORMS } from "@/lib/note-taker";
import { cn } from "@/lib/utils";
import { friendlyError, type Overview } from "./shared";

/** Paste a link → the bot joins now, or at the time you pick. */
export function RecordDialog({
  overview,
  onSent,
}: {
  overview: Overview;
  onSent: (meetingId: Id<"meetings">) => void;
}) {
  const sendBot = useAction(api.noteTakerActions.sendBot);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [sending, setSending] = useState(false);

  const platform = url.trim() ? detectPlatform(url) : null;
  const badLink = url.trim().length > 8 && !platform;
  const hours =
    overview.creditsPerMinute > 0
      ? overview.credits / overview.creditsPerMinute / 60
      : 0;
  const broke = overview.credits < overview.minCredits;

  const submit = async () => {
    setSending(true);
    try {
      const joinAt = when === "later" && at ? new Date(at).getTime() : undefined;
      if (when === "later" && (!joinAt || Number.isNaN(joinAt))) {
        toast.error("Pick when the meeting starts.");
        return;
      }
      const { meetingId } = await sendBot({
        meetingUrl: url,
        title: title.trim() || undefined,
        joinAt,
      });
      toast.success(
        joinAt
          ? "Scheduled — the note taker joins when the meeting starts."
          : `On its way — admit “${overview.settings.botName}” if there's a waiting room.`,
      );
      setOpen(false);
      setUrl("");
      setTitle("");
      setAt("");
      setWhen("now");
      if (!joinAt) onSent(meetingId);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't send the note taker."));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={!overview.configured}>
          <Video className="size-4" /> Record a meeting
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a meeting</DialogTitle>
          <DialogDescription>
            Paste the invite link. “{overview.settings.botName}” joins as a
            participant, records, and writes up the notes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nt-url">Meeting link</Label>
            <Input
              id="nt-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://meet.google.com/abc-defg-hij"
              autoComplete="off"
            />
            <p
              className={cn(
                "text-xs",
                badLink ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {platform
                ? `${MEETING_PLATFORMS[platform]} link ✓`
                : badLink
                  ? "That isn't a Zoom, Google Meet, Teams, Webex or GoTo link."
                  : "Zoom, Google Meet, Microsoft Teams, Webex and GoTo work."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nt-title">Title (optional)</Label>
            <Input
              id="nt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Left blank, the AI names it from the conversation"
            />
          </div>

          <div className="space-y-1.5">
            <Label>When</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["now", "Join now"],
                  ["later", "At a set time"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setWhen(value)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm transition-colors",
                    when === value
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {when === "later" && (
              <Input
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                aria-label="Meeting start time"
              />
            )}
          </div>

          <p className="rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
            {overview.creditsPerMinute} credits per recorded minute · you have{" "}
            {overview.credits.toLocaleString()} credits
            {hours >= 1 && ` (about ${Math.floor(hours)} hours)`}. The bot leaves
            on its own when everyone else does.
          </p>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={sending || !platform || broke || (when === "later" && !at)}
          >
            {sending && <Loader2 className="size-4 animate-spin" />}
            {broke
              ? "Not enough credits"
              : when === "later"
                ? "Schedule note taker"
                : "Send note taker"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
