/**
 * Audio tab catalog (runs on ElevenLabs — never named in the UI; labels
 * follow the app's "Studio" naming). Shared by the client (pickers, live
 * price) and Convex (validation, billing).
 */

export type TtsModel = {
  id: string;
  label: string;
  tagline: string;
  maxChars: number;
};

export const TTS_MODELS: TtsModel[] = [
  { id: "eleven_v4", label: "Studio Voice v4", tagline: "Most natural, expressive narration — 90+ languages.", maxChars: 5000 },
  { id: "eleven_v4_turbo", label: "Studio Voice v4 Turbo", tagline: "Fast, expressive speech — great for quick drafts.", maxChars: 5000 },
  {
    id: "eleven_v3",
    label: "Studio Voice v3 · Emotion tags",
    tagline: "Direct the delivery inline: [whispers], [laughs], [excited]…",
    maxChars: 3000,
  },
  { id: "eleven_multilingual_v2", label: "Studio Voice Multilingual", tagline: "Steady, faithful to cloned voices — 29 languages.", maxChars: 5000 },
  { id: "eleven_flash_v2_5", label: "Studio Voice Flash", tagline: "Lowest latency, clean everyday speech.", maxChars: 5000 },
];

export function findTtsModel(id: string): TtsModel | undefined {
  return TTS_MODELS.find((m) => m.id === id);
}

/** Dubbing languages (ISO codes the dubbing API takes). */
export const DUB_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "tr", label: "Turkish" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "id", label: "Indonesian" },
  { code: "ms", label: "Malay" },
  { code: "fil", label: "Filipino" },
  { code: "vi", label: "Vietnamese" },
  { code: "sv", label: "Swedish" },
  { code: "da", label: "Danish" },
  { code: "no", label: "Norwegian" },
  { code: "fi", label: "Finnish" },
  { code: "el", label: "Greek" },
  { code: "cs", label: "Czech" },
  { code: "sk", label: "Slovak" },
  { code: "ro", label: "Romanian" },
  { code: "bg", label: "Bulgarian" },
  { code: "hr", label: "Croatian" },
  { code: "hu", label: "Hungarian" },
];

export const MAX_VOICE_CHANGE_SEC = 300;
export const MAX_DUB_SEC = 600;

export type AudioPricing = {
  markup: number;
  creditPriceUsd: number;
  audioUsdPer1kChars: number;
  voiceChangeUsdPerMinute: number;
  dubbingUsdPerMinute: number;
};

/** Provider cost in USD for one audio job. */
export function audioBaseUsd(
  pricing: AudioPricing,
  job:
    | { feature: "tts"; chars: number }
    | { feature: "voice-change"; seconds: number }
    | { feature: "translate"; seconds: number },
): number {
  if (job.feature === "tts") return (Math.max(1, job.chars) / 1000) * pricing.audioUsdPer1kChars;
  const minutes = Math.max(1, Math.ceil(job.seconds)) / 60;
  return minutes * (job.feature === "voice-change" ? pricing.voiceChangeUsdPerMinute : pricing.dubbingUsdPerMinute);
}

/** Credits = cost × markup ÷ credit price, rounded up (same rule as Studio). */
export function audioCredits(pricing: AudioPricing, baseUsd: number): number {
  if (pricing.creditPriceUsd <= 0 || baseUsd <= 0) return 0;
  return Math.max(1, Math.ceil((baseUsd * pricing.markup) / pricing.creditPriceUsd));
}
