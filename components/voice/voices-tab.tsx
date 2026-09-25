"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AudioWaveform, Loader2, Play, Square, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListSkeleton } from "@/components/list-skeleton";
import { CloneVoiceCard } from "@/components/voice/clone-voice-card";
import { invalidateVoicesCache } from "@/components/voice/voice-picker";

type Voice = {
  id: string;
  name: string;
  description: string | null;
  curated: boolean;
  owned: boolean;
  provider: "bland" | "elevenlabs";
};

const CLONE_SLOTS = 10;

const ENGINE_BADGES = {
  bland: { label: "Bland", className: "bg-sky-500/15 text-sky-400" },
  elevenlabs: {
    label: "ElevenLabs",
    className: "bg-violet-500/15 text-violet-300",
  },
} as const;

export function VoicesTab() {
  const listVoices = useAction(api.voiceActions.listVoices);
  const voicePreview = useAction(api.voiceActions.voicePreview);
  const deleteClonedVoice = useAction(api.voiceActions.deleteClonedVoice);

  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Voice | null>(null);
  const [deleting, setDeleting] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Keyed by voice + line, so each clone renders a given sentence once.
  const sampleCache = useRef(new Map<string, string>());
  const [testLine, setTestLine] = useState("");

  const refresh = useCallback(() => {
    listVoices({ includeElevenLabs: true })
      .then(setVoices)
      .catch(() => setVoices([]));
  }, [listVoices]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stopPlayback = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  };

  const play = async (voice: Voice) => {
    if (playingId === voice.id) {
      stopPlayback();
      return;
    }
    stopPlayback();
    // The test line only applies to your clones — the comparison at hand.
    const line = voice.owned ? testLine.trim() : "";
    const cacheKey = `${voice.id}|${line}`;
    let sample = sampleCache.current.get(cacheKey);
    if (!sample) {
      setLoadingId(voice.id);
      try {
        const { audioBase64, mime } = await voicePreview({
          voiceId: voice.id,
          text: line || undefined,
        });
        sample = `data:${mime};base64,${audioBase64}`;
        sampleCache.current.set(cacheKey, sample);
      } catch {
        toast.error("Couldn't load a preview for this voice.");
        return;
      } finally {
        setLoadingId(null);
      }
    }
    const audio = new Audio(sample);
    audioRef.current = audio;
    setPlayingId(voice.id);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    void audio.play().catch(() => setPlayingId(null));
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteClonedVoice({ voiceId: deleteTarget.id });
      invalidateVoicesCache();
      sampleCache.current.clear();
      toast.success(`"${deleteTarget.name.trim()}" deleted — slot freed.`);
      setDeleteTarget(null);
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(msg.split("Uncaught Error: ").pop() || "Couldn't delete.");
    } finally {
      setDeleting(false);
    }
  };

  const owned = (voices ?? []).filter((v) => v.owned);
  const library = (voices ?? []).filter((v) => !v.owned);

  const voiceRow = (voice: Voice, deletable: boolean) => (
    <div
      key={voice.id}
      className="flex items-center justify-between gap-3 px-5 py-3.5"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{voice.name.trim()}</span>
          {voice.owned && (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${ENGINE_BADGES[voice.provider].className}`}
            >
              {ENGINE_BADGES[voice.provider].label}
            </span>
          )}
        </p>
        {voice.description && (
          <p className="truncate text-xs text-muted-foreground">
            {voice.description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="outline"
          size="icon"
          title="Play preview"
          onClick={() => play(voice)}
          disabled={loadingId !== null && loadingId !== voice.id}
        >
          {loadingId === voice.id ? (
            <Loader2 className="size-4 animate-spin" />
          ) : playingId === voice.id ? (
            <Square className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
        </Button>
        {deletable && (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            title="Delete voice"
            onClick={() => setDeleteTarget(voice)}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <CloneVoiceCard onCloned={refresh} />

      <div className="mt-6 mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Your cloned voices
        </h2>
        {voices !== null && (
          <p className="text-xs text-muted-foreground">
            {owned.length} of {CLONE_SLOTS} slots used
          </p>
        )}
      </div>
      {voices === null ? (
        <ListSkeleton rows={2} />
      ) : owned.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <AudioWaveform className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No cloned voices yet — record one above and it appears here and
              in every voice dropdown.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            <div className="space-y-1.5 px-5 py-3.5">
              <Input
                value={testLine}
                maxLength={300}
                onChange={(e) => setTestLine(e.target.value)}
                placeholder="Test line — type a sentence, then press play on each clone"
                aria-label="Test line for your cloned voices"
              />
              <p className="text-xs text-muted-foreground">
                Every clone says the same words, so you can judge Bland against
                ElevenLabs fairly. Left empty, they read a stock greeting.
              </p>
            </div>
            {owned.map((voice) => voiceRow(voice, true))}
          </CardContent>
        </Card>
      )}

      {library.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Studio voice library
          </h2>
          <Card>
            <CardContent className="max-h-96 divide-y divide-border overflow-y-auto p-0">
              {library.map((voice) => voiceRow(voice, false))}
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{deleteTarget?.name.trim()}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Any receptionist or qualifier using this voice falls back to a
              default voice. This can&apos;t be undone — you&apos;d need to
              re-record to get it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
