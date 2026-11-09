"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AudioLines,
  Coins,
  Download,
  Languages,
  Loader2,
  Mic,
  Pause,
  Play,
  Repeat2,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { hasConvex } from "@/lib/runtime";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/public-errors";
import {
  DUB_LANGUAGES,
  MAX_DUB_SEC,
  MAX_VOICE_CHANGE_SEC,
  TTS_MODELS,
  audioBaseUsd,
  audioCredits,
  findTtsModel,
} from "@/lib/audio-models";
import { chipClass } from "./studio-tab";
import { useUploader } from "./use-uploader";
import { handleGenerateError, probeVideoDuration } from "./generate-helpers";

type Feature = "tts" | "voice-change" | "translate";
const FEATURES: { id: Feature; label: string; icon: typeof Mic; blurb: string }[] = [
  { id: "tts", label: "Text to Speech", icon: Mic, blurb: "Type a script and pick a voice — your own cloned voices included." },
  { id: "voice-change", label: "Voice Change", icon: Repeat2, blurb: "Upload audio or video and swap the voice, keeping the timing and emotion." },
  { id: "translate", label: "Translate", icon: Languages, blurb: "Dub a video or audio into another language in the same voices." },
];

type Voice = { id: string; name: string; description: string | null; owned: boolean };

/* ------------------------------------------------------------------ */

function VoicePicker({ value, onChange }: { value: Voice | null; onChange: (v: Voice) => void }) {
  const listVoices = useAction(api.voiceActions.listVoices);
  const preview = useAction(api.voiceActions.voicePreview);
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  // The preview playing right now — starting another stops it.
  const [player, setPlayer] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    listVoices({ engine: "elevenlabs" })
      .then((list) => {
        if (cancelled) return;
        const mapped = list.map((v) => ({ id: v.id, name: v.name, description: v.description ?? null, owned: v.owned }));
        setVoices(mapped);
        if (!value && mapped[0]) onChange(mapped.find((v) => !v.owned) ?? mapped[0]);
      })
      .catch(() => !cancelled && setVoices([]));
    return () => {
      cancelled = true;
    };
    // Load once; `value`/`onChange` only seed the first pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listVoices]);

  const play = async (voice: Voice) => {
    player?.pause();
    if (playing === voice.id) {
      setPlaying(null);
      return;
    }
    setPlaying(voice.id);
    try {
      const { audioBase64, mime } = await preview({ voiceId: voice.id });
      const audio = new Audio(`data:${mime};base64,${audioBase64}`);
      audio.addEventListener("ended", () => setPlaying(null));
      await audio.play();
      setPlayer(audio);
    } catch (e) {
      setPlaying(null);
      toast.error(errorText(e, "Couldn't play a preview."));
    }
  };

  const shown = (voices ?? []).filter((v) => `${v.name} ${v.description ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const groups = [
    { label: "Your voices", items: shown.filter((v) => v.owned) },
    { label: "Voice library", items: shown.filter((v) => !v.owned) },
  ].filter((g) => g.items.length);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={chipClass} aria-label="Choose a voice">
          <AudioLines className="size-4 text-primary" />
          <span className="max-w-[10rem] truncate">{value?.name ?? (voices ? "Choose a voice" : "Loading voices…")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[min(22rem,calc(100vw-2rem))] gap-1 p-1.5">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search voices…" className="h-8" />
        <div className="max-h-[min(24rem,55dvh)] overflow-y-auto">
          {voices === null ? (
            <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin text-primary" /></div>
          ) : groups.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No voices found.</p>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">{g.label}</p>
                {g.items.map((v) => (
                  <div
                    key={v.id}
                    className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted", value?.id === v.id && "bg-muted")}
                  >
                    <button
                      type="button"
                      onClick={() => void play(v)}
                      className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border hover:border-primary/50"
                      aria-label={`Preview ${v.name}`}
                    >
                      {playing === v.id ? <Pause className="size-3" /> : <Play className="size-3" />}
                    </button>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        onChange(v);
                        setOpen(false);
                      }}
                    >
                      <span className="block truncate text-sm">{v.name}</span>
                      {v.description && <span className="block truncate text-[11px] text-muted-foreground">{v.description}</span>}
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Upload one audio or video file; reports its URL, length and type. */
function MediaUpload({
  value,
  onChange,
  accept,
  label,
}: {
  value: { url: string; name: string; seconds: number | null; isVideo: boolean } | null;
  onChange: (next: { url: string; name: string; seconds: number | null; isVideo: boolean } | null) => void;
  accept: string;
  label: string;
}) {
  const upload = useUploader();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handle = async (file: File) => {
    if (file.size > 200 * 1024 * 1024) {
      toast.error("Keep the file under 200 MB — trim it to the part you need.");
      return;
    }
    setBusy(true);
    try {
      const local = URL.createObjectURL(file);
      const seconds = await probeVideoDuration(local);
      URL.revokeObjectURL(local);
      const url = await upload(file);
      onChange({ url, name: file.name, seconds, isVideo: file.type.startsWith("video/") });
    } catch {
      toast.error("Upload failed — try again.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-2">
        {value.isVideo ? (
          <video src={`${value.url}#t=0.1`} muted playsInline preload="metadata" className="h-14 w-20 rounded-lg bg-black object-cover" />
        ) : (
          <span className="flex h-14 w-20 items-center justify-center rounded-lg bg-black/40"><AudioLines className="size-5 text-primary" /></span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{value.name}</p>
          <p className="text-xs text-muted-foreground">
            {value.seconds ? `${Math.floor(value.seconds / 60)}:${String(Math.ceil(value.seconds % 60)).padStart(2, "0")}` : "Length unknown"}
            {value.isVideo ? " · video" : " · audio"}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Remove file" onClick={() => onChange(null)}>
          <X className="size-4" />
        </Button>
      </div>
    );
  }
  return (
    <>
      <input ref={fileRef} type="file" accept={accept} className="hidden" onChange={(e) => e.target.files?.[0] && void handle(e.target.files[0])} />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) void handle(file);
        }}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {label}
      </button>
    </>
  );
}

function Slider({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-medium">
        {label} <span className="tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--primary)]"
      />
      <span className="block text-[11px] text-muted-foreground">{hint}</span>
    </label>
  );
}

/* ------------------------------------------------------------------ */

function AudioCard({ g }: { g: Doc<"generations"> }) {
  const busy = g.status === "pending" || g.status === "running";
  const p = (g.params ?? {}) as { feature?: Feature; voiceName?: string; targetLang?: string; modelId?: string };
  const feature = FEATURES.find((f) => f.id === p.feature) ?? FEATURES[0];
  const isVideo = g.kind === "video";
  const title =
    p.feature === "translate"
      ? `Translated to ${DUB_LANGUAGES.find((l) => l.code === p.targetLang)?.label ?? p.targetLang}`
      : p.feature === "voice-change"
        ? `Voice changed to ${p.voiceName ?? "new voice"}`
        : g.prompt;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-start gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <feature.icon className="size-4 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm">{title}</p>
          <p className="text-[11px] text-muted-foreground">
            {feature.label}
            {p.feature === "tts" && p.voiceName ? ` · ${p.voiceName}` : ""}
            {p.feature === "tts" && p.modelId ? ` · ${findTtsModel(p.modelId)?.label ?? ""}` : ""} · {g.costCredits} credits
          </p>
        </div>
        {g.status === "done" && g.resultUrl && (
          <a href={g.resultUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Download">
            <Download className="size-4" />
          </a>
        )}
      </div>
      {busy ? (
        <div className="flex items-center gap-2 rounded-lg bg-secondary/40 px-3 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          {p.feature === "translate" ? "Translating… this takes a few minutes" : "Working…"}
        </div>
      ) : g.status === "failed" ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">Failed — credits refunded</p>
      ) : g.resultUrl ? (
        isVideo ? (
          <video src={g.resultUrl} controls playsInline className="w-full rounded-lg bg-black" />
        ) : (
          <audio src={g.resultUrl} controls className="w-full" />
        )
      ) : null}
    </div>
  );
}

export function AudioTab() {
  if (!hasConvex) {
    return (
      <Card className="border-white/10">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <AudioLines className="size-8 text-muted-foreground" />
          <p className="font-medium">Audio</p>
          <p className="max-w-md text-sm text-muted-foreground">Audio needs Convex — preview-only until it is connected.</p>
        </CardContent>
      </Card>
    );
  }
  return <AudioTabLive />;
}

function AudioTabLive() {
  const pricing = useQuery(api.audio.pricing);
  const generations = useQuery(api.generations.list);
  const tts = useAction(api.audioActions.textToSpeech);
  const voiceChange = useAction(api.audioActions.voiceChange);
  const translate = useAction(api.audioActions.translate);

  const [feature, setFeature] = useState<Feature>("tts");
  const [voice, setVoice] = useState<Voice | null>(null);
  const [text, setText] = useState("");
  const [modelId, setModelId] = useState(TTS_MODELS[0].id);
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [style, setStyle] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [media, setMedia] = useState<{ url: string; name: string; seconds: number | null; isVideo: boolean } | null>(null);
  const [removeNoise, setRemoveNoise] = useState(false);
  const [targetLang, setTargetLang] = useState("es");
  const [sourceLang, setSourceLang] = useState("");
  const [busy, setBusy] = useState(false);

  const model = findTtsModel(modelId)!;
  const items = useMemo(
    () => (generations ?? []).filter((g) => g.provider === "elevenlabs"),
    [generations],
  );

  const validation = (() => {
    if (feature === "tts") {
      if (!voice) return "Choose a voice";
      if (!text.trim()) return "Write something to say";
      if (text.length > model.maxChars) return `Up to ${model.maxChars.toLocaleString()} characters`;
      return null;
    }
    if (!media) return feature === "translate" ? "Upload a video or audio" : "Upload audio or video";
    if (!media.seconds) return "Couldn't read the file's length";
    const max = feature === "translate" ? MAX_DUB_SEC : MAX_VOICE_CHANGE_SEC;
    if (media.seconds > max) return `Keep it under ${max / 60} minutes`;
    if (feature === "voice-change" && !voice) return "Choose the new voice";
    if (feature === "translate" && sourceLang === targetLang) return "Pick a different language";
    return null;
  })();

  const credits = (() => {
    if (!pricing) return 0;
    const base =
      feature === "tts"
        ? audioBaseUsd(pricing, { feature: "tts", chars: text.trim().length || 1 })
        : audioBaseUsd(pricing, { feature, seconds: media?.seconds ?? 60 });
    return audioCredits(pricing, base);
  })();

  const run = async () => {
    if (validation) {
      toast.error(validation);
      return;
    }
    setBusy(true);
    try {
      if (feature === "tts") {
        await tts({
          voiceId: voice!.id,
          voiceName: voice!.name,
          text,
          modelId,
          stability,
          similarityBoost: similarity,
          style,
          speed,
        });
        toast.success("Done — it's at the top of the list.");
      } else if (feature === "voice-change") {
        await voiceChange({
          voiceId: voice!.id,
          voiceName: voice!.name,
          mediaUrl: media!.url,
          fileName: media!.name,
          durationSec: media!.seconds ?? undefined,
          removeBackgroundNoise: removeNoise,
        });
        toast.success("Done — your new take is at the top of the list.");
      } else {
        await translate({
          mediaUrl: media!.url,
          isVideo: media!.isVideo,
          durationSec: media!.seconds ?? undefined,
          targetLang,
          sourceLang: sourceLang || undefined,
        });
        toast.success("Translating — it takes a few minutes and appears above.");
      }
    } catch (e) {
      const message = e instanceof Error ? errorText(e, "") ?? "" : "";
      if (/first$|characters|minutes|language|length|Unknown model|voice/i.test(message)) toast.error(message);
      else handleGenerateError(e);
    } finally {
      setBusy(false);
    }
  };

  const current = FEATURES.find((f) => f.id === feature)!;

  return (
    <div className="flex min-h-[calc(100dvh-15rem)] flex-col">
      <div className="flex-1 pb-6">
        {generations === undefined ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-secondary/50" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="flex min-h-[38dvh] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10"><AudioLines className="size-5 text-primary" /></span>
            <p className="font-medium">Your audio appears here</p>
            <p className="max-w-sm px-4 text-sm text-muted-foreground">Pick a mode below — Text to Speech, Voice Change or Translate.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((g) => <AudioCard key={g._id} g={g} />)}
          </div>
        )}
      </div>

      <div className="sticky bottom-3 z-20 mx-auto w-full max-w-4xl">
        <div className="rounded-2xl border border-border bg-card/95 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-4">
          <div className="mb-2 flex gap-1 overflow-x-auto pb-0.5">
            {FEATURES.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFeature(f.id)}
                className={cn(chipClass, feature === f.id && "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20")}
              >
                <f.icon className="size-3.5" /> {f.label}
              </button>
            ))}
          </div>
          <p className="mb-3 text-xs text-muted-foreground">{current.blurb}</p>

          {feature === "tts" ? (
            <div className="relative">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                maxLength={model.maxChars}
                aria-label="Script"
                placeholder={
                  model.id === "eleven_v3"
                    ? "Type your script. Add delivery tags like [whispers], [laughs] or [excited] where you want them."
                    : "Type what the voice should say…"
                }
                className="field-sizing-content max-h-56 min-h-20 w-full resize-none bg-transparent px-1 py-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
              />
              <span className="absolute bottom-1 right-1 text-[10px] tabular-nums text-muted-foreground">
                {text.length.toLocaleString()} / {model.maxChars.toLocaleString()}
              </span>
            </div>
          ) : (
            <MediaUpload
              value={media}
              onChange={setMedia}
              accept={feature === "translate" ? "video/*,audio/*" : "audio/*,video/*"}
              label={feature === "translate" ? "Upload the video or audio to translate" : "Upload the audio or video to re-voice"}
            />
          )}

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {feature !== "translate" && <VoicePicker value={voice} onChange={setVoice} />}
              {feature === "tts" && (
                <>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className={chipClass} aria-label="Voice model">
                        <Sparkles className="size-3.5" /> {model.label}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" className="w-80 gap-0 p-1.5">
                      {TTS_MODELS.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setModelId(m.id)}
                          className={cn("w-full rounded-md px-2 py-2 text-left hover:bg-muted", m.id === modelId && "bg-muted")}
                        >
                          <span className="block text-sm font-medium">{m.label}</span>
                          <span className="block text-[11px] text-muted-foreground">{m.tagline}</span>
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className={chipClass} aria-label="Voice settings">
                        <SlidersHorizontal className="size-3.5" /> Settings
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" className="w-72 space-y-3 p-3">
                      <Slider label="Stability" hint="Lower = more expressive, higher = more consistent." value={stability} onChange={setStability} />
                      <Slider label="Similarity" hint="How closely to match the original voice." value={similarity} onChange={setSimilarity} />
                      <Slider label="Style" hint="Exaggerates the speaker's style. Keep low for clones." value={style} onChange={setStyle} />
                      <Slider label="Speed" hint="0.7 = slower, 1.2 = faster." value={speed} onChange={setSpeed} min={0.7} max={1.2} step={0.05} />
                    </PopoverContent>
                  </Popover>
                </>
              )}
              {feature === "voice-change" && (
                <label className={cn(chipClass, "cursor-pointer")}>
                  <Switch checked={removeNoise} onCheckedChange={setRemoveNoise} aria-label="Remove background noise" />
                  Remove background noise
                </label>
              )}
              {feature === "translate" && (
                <>
                  <label className={cn(chipClass, "gap-2")}>
                    <span className="text-muted-foreground">From</span>
                    <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} className="bg-transparent text-sm outline-none" aria-label="Original language">
                      <option value="">Auto-detect</option>
                      {DUB_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </label>
                  <label className={cn(chipClass, "gap-2")}>
                    <span className="text-muted-foreground">To</span>
                    <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className="bg-transparent text-sm outline-none" aria-label="Translate to">
                      {DUB_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </label>
                </>
              )}
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-1">
              <Button
                onClick={() => void run()}
                disabled={busy || Boolean(validation)}
                title={validation ?? "Generate"}
                className="h-14 min-w-40 flex-col gap-0.5 rounded-xl px-6 text-base font-semibold"
              >
                <span className="flex items-center gap-1.5">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <current.icon className="size-4" />}
                  Generate
                </span>
                <span className="flex items-center gap-1 text-[11px] font-medium opacity-80">
                  <Coins className="size-3" /> {credits.toLocaleString()} credits
                </span>
              </Button>
              <p className="text-center text-[10px] text-muted-foreground">
                {validation ?? (feature === "tts" ? "priced per character" : "priced per minute")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
