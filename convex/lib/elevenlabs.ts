/**
 * ElevenLabs adapter — the second voice-clone engine, selectable next to
 * Bland. Instant Voice Cloning + text-to-speech only: clones made here power
 * previews and IG voice notes. They can NOT answer phone calls — the
 * receptionist/qualifier run on Bland's telephony, which only speaks Bland
 * voices. No-op guard until ELEVENLABS_API_KEY is set (IVC needs a paid
 * ElevenLabs plan). Docs: https://elevenlabs.io/docs/api-reference
 */

const BASE = "https://api.elevenlabs.io/v1";

/** Best clone fidelity; multilingual. */
const TTS_MODEL = "eleven_multilingual_v2";

export function elevenConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("NOT_CONFIGURED: ELEVENLABS_API_KEY is not set");
  return key;
}

/** ElevenLabs errors look like {detail:{status,message}} or {detail:"…"}. */
async function failure(res: Response, what: string): Promise<Error> {
  const text = await res.text();
  let detail = text.slice(0, 300);
  let code = "";
  try {
    const parsed = JSON.parse(text) as {
      detail?: { message?: string; status?: string } | string;
    };
    if (typeof parsed.detail === "string") detail = parsed.detail;
    else {
      if (parsed.detail?.message) detail = parsed.detail.message;
      if (parsed.detail?.status) code = parsed.detail.status;
    }
  } catch {
    // Keep the raw body.
  }
  console.error(`ElevenLabs ${res.status} on ${what}: ${text.slice(0, 500)}`);
  return new Error(`ElevenLabs ${res.status}${code ? ` [${code}]` : ""}: ${detail}`);
}

/** The voice id isn't (or is no longer) in the account. */
export function isVoiceMissingError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^ElevenLabs (404|400 \[voice_not_found\])/.test(error.message)
  );
}

/** The account is out of custom-voice slots. */
export function isVoiceLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^ElevenLabs \d+/.test(error.message) &&
    /voice_limit_reached|maximum amount of custom voices|voice slots?/i.test(
      error.message,
    )
  );
}

/**
 * Instant Voice Clone from one recording. Quality scales with sample
 * length — a minute or more of clean speech is the sweet spot.
 */
export async function cloneVoice(args: {
  name: string;
  audio: Blob;
  filename: string;
  gender?: string;
  description?: string;
}): Promise<string> {
  // Hand-rolled multipart, same as the Bland adapter — the runtime's
  // FormData boundary has tripped bot rules before.
  const boundary = `----gwu${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const field = (name: string, value: string) => {
    chunks.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  };
  field("name", args.name);
  if (args.description) field("description", args.description);
  if (args.gender) field("labels", JSON.stringify({ gender: args.gender }));
  chunks.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${args.filename}"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
  );
  chunks.push(new Uint8Array(await args.audio.arrayBuffer()));
  chunks.push(encoder.encode(`\r\n--${boundary}--\r\n`));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  const res = await fetch(`${BASE}/voices/add`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
      accept: "application/json",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw await failure(res, "voices/add");
  const parsed = (await res.json()) as { voice_id?: string };
  if (!parsed.voice_id) throw new Error("ElevenLabs returned no voice id");
  return parsed.voice_id;
}

/**
 * ElevenLabs' own stock ("premade") voices — usable by agents on any plan
 * and never counted against voice slots. Our pooled clones are excluded.
 */
export async function listStockVoices(): Promise<
  { id: string; name: string; description: string | null }[]
> {
  const res = await fetch(`${BASE}/voices`, { headers: { "xi-api-key": apiKey() } });
  if (!res.ok) throw await failure(res, "voices");
  const parsed = (await res.json()) as {
    voices?: {
      voice_id: string;
      name: string;
      category?: string;
      description?: string | null;
      labels?: Record<string, string>;
    }[];
  };
  return (parsed.voices ?? [])
    .filter((v) => v.category === "premade")
    .map((v) => ({
      id: v.voice_id,
      // "Roger - Laid-Back, Casual, Resonant" → name + description.
      name: v.name.split(" - ")[0].trim(),
      description:
        v.name.split(" - ").slice(1).join(" - ").trim() ||
        v.description ||
        [v.labels?.accent, v.labels?.gender].filter(Boolean).join(" · ") ||
        null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteVoice(voiceId: string): Promise<void> {
  const res = await fetch(`${BASE}/voices/${encodeURIComponent(voiceId)}`, {
    method: "DELETE",
    headers: { "xi-api-key": apiKey() },
  });
  // Already gone upstream is as good as deleted.
  if (!res.ok && res.status !== 404) throw await failure(res, "voices/delete");
}

async function speak(
  voiceId: string,
  text: string,
  outputFormat: string,
): Promise<Response> {
  return await fetch(
    `${BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${outputFormat}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: TTS_MODEL,
        voice_settings: {
          stability: 0.5,
          // Lean toward the original speaker — this is a clone, not a persona.
          similarity_boost: 0.85,
          style: 0,
          use_speaker_boost: true,
        },
      }),
    },
  );
}

/** Speak text as MP3 — available on every ElevenLabs tier. */
export async function ttsMp3(voiceId: string, text: string): Promise<Uint8Array> {
  const res = await speak(voiceId, text, "mp3_44100_128");
  if (!res.ok) throw await failure(res, "text-to-speech");
  return new Uint8Array(await res.arrayBuffer());
}

/** Raw 16-bit mono PCM → a playable/mixable WAV. */
function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/**
 * Speech for a voice note. WAV (mixable with an ambiance bed) when the
 * account's tier allows PCM output — ElevenLabs gates that to Pro — else
 * MP3, which goes out clean with no background.
 */
export async function ttsForVoiceNote(
  voiceId: string,
  text: string,
): Promise<{ bytes: Uint8Array; mime: "audio/wav" | "audio/mpeg" }> {
  const pcm = await speak(voiceId, text, "pcm_24000");
  if (pcm.ok) {
    const raw = new Uint8Array(await pcm.arrayBuffer());
    return { bytes: pcmToWav(raw, 24000), mime: "audio/wav" };
  }
  // 401/403 here = the tier doesn't include PCM; anything else is real.
  if (pcm.status !== 401 && pcm.status !== 403) {
    throw await failure(pcm, "text-to-speech (pcm)");
  }
  return { bytes: await ttsMp3(voiceId, text), mime: "audio/mpeg" };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ── Audio tab: text-to-speech, voice changer, dubbing ──────────────────

export type AudioVoiceSettings = {
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
};

/** Text-to-speech with an explicit model and settings → MP3 bytes. */
export async function synthesize(args: {
  voiceId: string;
  text: string;
  modelId: string;
  settings?: AudioVoiceSettings;
}): Promise<Uint8Array> {
  const s = args.settings ?? {};
  // Eleven v3 only accepts three stability steps (creative / natural / robust).
  const v3 = args.modelId.startsWith("eleven_v3");
  const stability = v3
    ? [0, 0.5, 1].reduce((best, step) =>
        Math.abs(step - (s.stability ?? 0.5)) < Math.abs(best - (s.stability ?? 0.5)) ? step : best,
      )
    : (s.stability ?? 0.5);
  const res = await fetch(
    `${BASE}/text-to-speech/${encodeURIComponent(args.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({
        text: args.text,
        model_id: args.modelId,
        voice_settings: {
          stability,
          similarity_boost: s.similarityBoost ?? 0.75,
          style: s.style ?? 0,
          use_speaker_boost: true,
          ...(s.speed !== undefined && { speed: s.speed }),
        },
      }),
    },
  );
  if (!res.ok) throw await failure(res, "text-to-speech");
  return new Uint8Array(await res.arrayBuffer());
}

/** Voice changer: same words, timing and emotion in another voice → MP3. */
export async function changeVoice(args: {
  voiceId: string;
  media: Blob;
  fileName: string;
  removeBackgroundNoise?: boolean;
}): Promise<Uint8Array> {
  const form = new FormData();
  form.append("audio", args.media, args.fileName);
  form.append("model_id", "eleven_multilingual_sts_v2");
  form.append("remove_background_noise", String(Boolean(args.removeBackgroundNoise)));
  form.append(
    "voice_settings",
    JSON.stringify({ stability: 0.5, similarity_boost: 0.85, style: 0, use_speaker_boost: true }),
  );
  const res = await fetch(
    `${BASE}/speech-to-speech/${encodeURIComponent(args.voiceId)}?output_format=mp3_44100_128`,
    { method: "POST", headers: { "xi-api-key": apiKey() }, body: form },
  );
  if (!res.ok) throw await failure(res, "speech-to-speech");
  return new Uint8Array(await res.arrayBuffer());
}

/** Start a dub (translate a video/audio into another language, same voices). */
export async function startDubbing(args: {
  sourceUrl: string;
  targetLang: string;
  sourceLang?: string;
  name: string;
}): Promise<{ dubbingId: string; expectedSec?: number }> {
  const form = new FormData();
  form.append("source_url", args.sourceUrl);
  form.append("target_lang", args.targetLang);
  form.append("source_lang", args.sourceLang || "auto");
  form.append("num_speakers", "0");
  form.append("name", args.name.slice(0, 100));
  form.append("watermark", "false");
  form.append("highest_resolution", "true");
  const res = await fetch(`${BASE}/dubbing`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
  });
  if (!res.ok) throw await failure(res, "dubbing");
  const parsed = (await res.json()) as { dubbing_id?: string; expected_duration_sec?: number };
  if (!parsed.dubbing_id) throw new Error("ElevenLabs dubbing returned no id");
  return { dubbingId: parsed.dubbing_id, expectedSec: parsed.expected_duration_sec };
}

export async function getDubbing(
  dubbingId: string,
): Promise<{ status: string; error: string | null }> {
  const res = await fetch(`${BASE}/dubbing/${encodeURIComponent(dubbingId)}`, {
    headers: { "xi-api-key": apiKey() },
  });
  if (!res.ok) throw await failure(res, "dubbing/status");
  const parsed = (await res.json()) as { status?: string; error?: string | null };
  return { status: String(parsed.status ?? "dubbing"), error: parsed.error ?? null };
}

/** The finished dub for one language (MP4 for video sources, MP3 for audio). */
export async function getDubbedFile(dubbingId: string, lang: string): Promise<Blob> {
  const res = await fetch(
    `${BASE}/dubbing/${encodeURIComponent(dubbingId)}/audio/${encodeURIComponent(lang)}`,
    { headers: { "xi-api-key": apiKey() } },
  );
  if (!res.ok) throw await failure(res, "dubbing/file");
  return await res.blob();
}
