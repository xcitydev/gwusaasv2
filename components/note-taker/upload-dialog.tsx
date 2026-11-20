"use client";

import { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { FileAudio, Loader2, Upload } from "lucide-react";
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
import { MinutesMeter, friendlyError, type Overview } from "./shared";

/** Upload limit — long meetings as video can be big; audio is far smaller. */
const MAX_BYTES = 1024 * 1024 * 1024;

/**
 * Upload a recording (in-person meeting, phone call, Slack huddle) and get
 * the same notes, transcript, search and score as a bot-recorded meeting.
 */
export function UploadDialog({
  overview,
  onUploaded,
}: {
  overview: Overview;
  onUploaded: (meetingId: Id<"meetings">) => void;
}) {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const uploadMeeting = useAction(api.noteTakerUpload.uploadMeeting);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<"uploading" | "starting" | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const broke = overview.credits < overview.minCredits;

  const submit = async () => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error("That file is over 1 GB — export the audio only and upload that.");
      return;
    }
    setBusy("uploading");
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("The upload didn't go through — try again.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      setBusy("starting");
      const { meetingId } = await uploadMeeting({
        storageId,
        fileName: file.name,
        title: title.trim() || undefined,
      });
      toast.success("Uploaded — the transcript and notes follow in a few minutes.");
      setOpen(false);
      setFile(null);
      setTitle("");
      onUploaded(meetingId);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't upload that recording."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!overview.configured}>
          <Upload className="size-4" /> Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload a recording</DialogTitle>
          <DialogDescription>
            In-person meetings, phone calls, huddles — any audio or video. You
            get the same notes, transcript and score as a recorded call.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-primary/50"
          >
            <FileAudio className="size-6 text-primary" />
            {file ? (
              <>
                <span className="max-w-full truncate text-sm font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  {(file.size / (1024 * 1024)).toFixed(1)} MB · click to change
                </span>
              </>
            ) : (
              <>
                <span className="text-sm font-medium">Choose a file</span>
                <span className="text-xs text-muted-foreground">MP3, M4A, WAV, MP4, MOV… up to 1 GB</span>
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="space-y-1.5">
            <Label htmlFor="nt-upload-title">Title (optional)</Label>
            <Input
              id="nt-upload-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Left blank, the AI names it from the conversation"
            />
          </div>
          <MinutesMeter overview={overview} />
          <p className="text-xs text-muted-foreground">
            Billed like a recorded meeting: {overview.creditsPerMinute} credits per
            minute of the recording. Speakers are labelled Speaker 1, 2, …
          </p>
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!file || busy !== null || broke}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy === "uploading" ? "Uploading…" : busy === "starting" ? "Starting…" : "Upload & transcribe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
