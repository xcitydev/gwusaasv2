"use client";

import { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AudioWaveform, Loader2, Mic, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { invalidateVoicesCache } from "@/components/voice/voice-picker";

// Keep them talking naturally — the content doesn't matter, the voice does.
const PROMPTS = [
  "What do you sell, and who is it for?",
  "Tell the story of your favorite customer win.",
  "What does a typical day at your business look like?",
  "What made you start this business in the first place?",
  "Describe your city to someone who's never been.",
];

/** 16-bit PCM mono WAV from an AudioBuffer — Bland's preferred format. */
function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const rate = buffer.sampleRate;
  // Downmix to mono.
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }
  const out = new DataView(new ArrayBuffer(44 + length * 2));
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  out.setUint32(4, 36 + length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, 1, true); // mono
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  writeStr(36, "data");
  out.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    out.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}

const MAX_SECONDS = 45;

export function CloneVoiceCard({ onCloned }: { onCloned?: () => void }) {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const cloneMyVoice = useAction(api.voiceActions.cloneMyVoice);

  const [open, setOpen] = useState(false);
  const [voiceName, setVoiceName] = useState("");
  const [gender, setGender] = useState<string>("unset");
  const [recState, setRecState] = useState<"idle" | "recording" | "recorded">("idle");
  const [seconds, setSeconds] = useState(0);
  const [promptIndex, setPromptIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [doneVoice, setDoneVoice] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const resetRecording = () => {
    setPreviewUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    blobRef.current = null;
    setSeconds(0);
    setRecState("idle");
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        blobRef.current = blob;
        setPreviewUrl(URL.createObjectURL(blob));
        setRecState("recorded");
      };
      recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      setRecState("recording");
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stopRecording();
          return s + 1;
        });
      }, 1000);
    } catch {
      toast.error("Microphone access was blocked — allow it and try again.");
    }
  };

  const create = async () => {
    if (!blobRef.current) return;
    if (!voiceName.trim()) {
      toast.error("Give your voice a name first.");
      return;
    }
    if (seconds < 8) {
      toast.error("Record at least ~10 seconds — quality depends on it.");
      return;
    }
    setCreating(true);
    try {
      // Convert the browser recording to WAV (what the clone engine wants).
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(await blobRef.current.arrayBuffer());
      void ctx.close();
      const wav = encodeWav(decoded);
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
      });
      if (!res.ok) throw new Error("Upload failed — try again");
      const { storageId } = await res.json();
      await cloneMyVoice({
        name: voiceName.trim(),
        storageId,
        gender: gender === "unset" ? undefined : gender,
      });
      invalidateVoicesCache();
      onCloned?.();
      setDoneVoice(voiceName.trim());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(msg.split("Uncaught Error: ").pop() || "Cloning failed.");
    } finally {
      setCreating(false);
    }
  };

  const closeDialog = () => {
    if (recState === "recording") stopRecording();
    resetRecording();
    setDoneVoice(null);
    setOpen(false);
  };

  return (
    <>
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
        <CardContent className="flex flex-col items-start justify-between gap-4 py-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <AudioWaveform className="size-5" />
            </span>
            <div>
              <p className="font-medium">Clone your voice</p>
              <p className="text-sm text-muted-foreground">
                15 seconds of talking — then your receptionist and qualifier can
                answer in <span className="text-foreground">your</span> voice.
              </p>
            </div>
          </div>
          <Button onClick={() => setOpen(true)}>
            <Mic className="size-4" /> Clone my voice
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          {doneVoice ? (
            <>
              <DialogHeader>
                <DialogTitle>Your voice is ready</DialogTitle>
                <DialogDescription>
                  &ldquo;{doneVoice}&rdquo; is now in every voice dropdown —
                  pick it for a receptionist or qualifier and hit the preview
                  button to hear yourself.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={closeDialog}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Clone your voice</DialogTitle>
                <DialogDescription>
                  Talk naturally for 15–45 seconds. Quiet room, close to the
                  mic — the sample quality sets your voice quality.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="mb-1.5">Voice name</Label>
                    <Input
                      placeholder="Kingsley's voice"
                      value={voiceName}
                      onChange={(e) => setVoiceName(e.target.value)}
                      maxLength={30}
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5">Gender (optional)</Label>
                    <Select value={gender} onValueChange={setGender}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unset">Skip</SelectItem>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-center">
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    Don&apos;t know what to say? Answer this
                  </p>
                  <p className="mt-1 text-sm font-medium">{PROMPTS[promptIndex]}</p>
                  <button
                    className="mt-1 text-xs text-primary hover:underline"
                    onClick={() => setPromptIndex((i) => (i + 1) % PROMPTS.length)}
                  >
                    Another question
                  </button>
                </div>

                <div className="flex flex-col items-center gap-3 py-2">
                  {recState === "recording" && (
                    <p className="font-mono text-2xl tabular-nums text-primary">
                      0:{String(seconds).padStart(2, "0")}
                    </p>
                  )}
                  {recState === "recorded" && previewUrl && (
                    <audio controls src={previewUrl} className="w-full" />
                  )}
                  {recState === "idle" && (
                    <Button size="lg" onClick={startRecording}>
                      <Mic className="size-4" /> Start recording
                    </Button>
                  )}
                  {recState === "recording" && (
                    <Button size="lg" variant="destructive" onClick={stopRecording}>
                      <Square className="size-4" /> Stop
                    </Button>
                  )}
                  {recState === "recorded" && (
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={resetRecording}>
                        <RotateCcw className="size-4" /> Re-record
                      </Button>
                      <Button onClick={create} disabled={creating}>
                        {creating && <Loader2 className="size-4 animate-spin" />}
                        Create my voice
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
