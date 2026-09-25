"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type VoiceOption = {
  id: string;
  name: string;
  description: string | null;
  curated: boolean;
  provider?: "bland" | "elevenlabs";
};

// Voices and samples barely change — cache for the session so pickers on
// different pages don't refetch or re-bill previews. Call pickers and TTS
// pickers (which add ElevenLabs clones) see different lists.
const voicesCache: { calls: VoiceOption[] | null; tts: VoiceOption[] | null } = {
  calls: null,
  tts: null,
};
const sampleCache = new Map<string, string>();

/** Call after cloning a voice so pickers refetch the library. */
export function invalidateVoicesCache() {
  voicesCache.calls = null;
  voicesCache.tts = null;
  sampleCache.clear();
}

/** Voice dropdown with an in-app "hear it" preview button. */
export function VoicePicker({
  value,
  onChange,
  includeTts = false,
}: {
  value: string;
  onChange: (voiceId: string) => void;
  /**
   * Also offer ElevenLabs clones. Only for text-to-speech surfaces (IG
   * voice notes) — phone calls run on Bland and can't speak them.
   */
  includeTts?: boolean;
}) {
  const listVoices = useAction(api.voiceActions.listVoices);
  const voicePreview = useAction(api.voiceActions.voicePreview);
  const cacheKey = includeTts ? "tts" : "calls";
  const [voices, setVoices] = useState<VoiceOption[]>(voicesCache[cacheKey] ?? []);
  const [loadingSample, setLoadingSample] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (voicesCache[cacheKey]) return;
    listVoices(includeTts ? { includeElevenLabs: true } : {})
      .then((list) => {
        voicesCache[cacheKey] = list;
        setVoices(list);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Legacy voices ("maya") predate the picker — keep them selectable.
  const known = voices.some((v) => v.id === value);

  const stopPlayback = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
  };

  const preview = async () => {
    if (playing) {
      stopPlayback();
      return;
    }
    let sample = sampleCache.get(value);
    if (!sample) {
      setLoadingSample(true);
      try {
        const { audioBase64, mime } = await voicePreview({ voiceId: value });
        sample = `data:${mime};base64,${audioBase64}`;
        sampleCache.set(value, sample);
      } catch {
        toast.error("Couldn't load a preview for this voice.");
        return;
      } finally {
        setLoadingSample(false);
      }
    }
    const audio = new Audio(sample);
    audioRef.current = audio;
    setPlaying(true);
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    void audio.play().catch(() => setPlaying(false));
  };

  return (
    <div className="flex gap-2">
      <Select
        value={value}
        onValueChange={(v) => {
          stopPlayback();
          onChange(v);
        }}
      >
        <SelectTrigger className="w-full min-w-0">
          <SelectValue placeholder="Pick a voice" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {!known && value && (
            <SelectItem value={value}>
              <span className="capitalize">{value}</span>
              <span className="ml-1.5 text-xs text-muted-foreground">
                (current)
              </span>
            </SelectItem>
          )}
          {voices.map((voice) => (
            <SelectItem key={voice.id} value={voice.id}>
              <span>{voice.name.trim()}</span>
              {voice.provider === "elevenlabs" && (
                <span className="ml-1.5 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">
                  ElevenLabs
                </span>
              )}
              {voice.description && (
                <span className="ml-1.5 max-w-56 truncate text-xs text-muted-foreground">
                  {voice.description}
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        title="Hear this voice"
        onClick={preview}
        disabled={loadingSample || !value}
      >
        {loadingSample ? (
          <Loader2 className="size-4 animate-spin" />
        ) : playing ? (
          <Square className="size-4" />
        ) : (
          <Play className="size-4" />
        )}
      </Button>
    </div>
  );
}

export const BACKGROUND_TRACKS = [
  { value: "default", label: "Phone static (default)" },
  { value: "office", label: "Office — typing, faint chatter" },
  { value: "cafe", label: "Cafe — talking, clinking" },
  { value: "restaurant", label: "Restaurant — subtle bustle" },
  { value: "none", label: "Silent" },
] as const;

/** Ambiance select — "default" means unset (Bland's quiet phone static). */
export function BackgroundPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (track: string | undefined) => void;
}) {
  return (
    <Select
      value={value ?? "default"}
      onValueChange={(v) => onChange(v === "default" ? undefined : v)}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {BACKGROUND_TRACKS.map((track) => (
          <SelectItem key={track.value} value={track.value}>
            {track.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
