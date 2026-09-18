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
import { ListSkeleton } from "@/components/list-skeleton";
import { CloneVoiceCard } from "@/components/voice/clone-voice-card";
import { invalidateVoicesCache } from "@/components/voice/voice-picker";

type Voice = {
  id: string;
  name: string;
  description: string | null;
  curated: boolean;
  owned: boolean;
};

const CLONE_SLOTS = 10;

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
  const sampleCache = useRef(new Map<string, string>());

  const refresh = useCallback(() => {
    listVoices({})
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
    let sample = sampleCache.current.get(voice.id);
    if (!sample) {
      setLoadingId(voice.id);
      try {
        const { audioBase64 } = await voicePreview({ voiceId: voice.id });
        sample = audioBase64;
        sampleCache.current.set(voice.id, sample);
      } catch {
        toast.error("Couldn't load a preview for this voice.");
        return;
      } finally {
        setLoadingId(null);
      }
    }
    const audio = new Audio(`data:audio/wav;base64,${sample}`);
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
      sampleCache.current.delete(deleteTarget.id);
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
        <p className="truncate text-sm font-medium">{voice.name.trim()}</p>
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
