import { type Ambiance } from "../../lib/ig-dms";

/**
 * Tiny WAV toolkit for IG voice notes: decode Bland's PCM WAV, lay an
 * ambiance bed under the speech, re-encode. Handles 16-bit PCM (what Bland
 * returns); anything else passes through unmixed rather than failing the
 * send. Pure TypedArray math — runs in the default Convex runtime.
 */

export type PcmWav = {
  sampleRate: number;
  channels: number;
  /** Interleaved samples in [-1, 1]. */
  samples: Float32Array;
};

export function decodeWav(bytes: Uint8Array): PcmWav | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let format: {
    code: number;
    channels: number;
    sampleRate: number;
    bits: number;
  } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = {
        code: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!format || format.bits !== 16) return null;
      // 1 = PCM, 0xfffe = extensible (PCM sub-format in practice).
      if (format.code !== 1 && format.code !== 0xfffe) return null;
      const count = Math.min(size, bytes.length - body) >> 1;
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        samples[i] = view.getInt16(body + i * 2, true) / 32768;
      }
      return {
        sampleRate: format.sampleRate,
        channels: format.channels,
        samples,
      };
    }
    offset = body + size + (size & 1);
  }
  return null;
}

export function encodeWav(pcm: PcmWav): Uint8Array {
  const dataBytes = pcm.samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, pcm.channels, true);
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, pcm.sampleRate * pcm.channels * 2, true);
  view.setUint16(32, pcm.channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm.samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return out;
}

// ── Beds ────────────────────────────────────────────────────────────────

/** Deterministic PRNG so the same script renders the same bed. */
function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

/**
 * Procedural mono bed of `length` frames. These are synthesized textures —
 * a decent "recorded in a room" feel, not a field recording. Real beds win:
 * drop office.wav / cafe.wav / room.wav behind IG_AMBIANCE_BASE_URL and
 * `loadBed` uses them instead.
 */
export function generateBed(
  kind: Exclude<Ambiance, "none">,
  sampleRate: number,
  length: number,
): Float32Array {
  const out = new Float32Array(length);
  const random = rng(kind.length * 7919 + length);
  // Brown noise (leaky integrator) is the base "air" for every bed.
  let brown = 0;
  // Pink-ish layers via one-pole lowpasses at different rates.
  let lp1 = 0;
  let lp2 = 0;
  // Slow murmur LFOs for the cafe.
  const lfoA = 0.23 + random() * 0.2;
  const lfoB = 0.61 + random() * 0.3;
  let nextClick = Math.floor(sampleRate * (0.3 + random()));
  let clickLeft = 0;
  let clickGain = 0;
  let clickPhase = 0;
  for (let i = 0; i < length; i++) {
    const white = random() * 2 - 1;
    brown = (brown + 0.02 * white) / 1.02;
    lp1 += 0.05 * (white - lp1);
    lp2 += 0.005 * (white - lp2);
    let value: number;
    if (kind === "room") {
      value = brown * 3.5 + lp2 * 0.6;
    } else if (kind === "office") {
      // Mains-ish hum + air + sparse soft key clicks.
      const hum = Math.sin((2 * Math.PI * 60 * i) / sampleRate) * 0.12;
      value = brown * 3 + lp1 * 0.25 + hum;
      if (i >= nextClick) {
        clickLeft = Math.floor(sampleRate * 0.012);
        clickGain = 0.25 + random() * 0.25;
        nextClick = i + Math.floor(sampleRate * (0.12 + random() * 0.5));
      }
      if (clickLeft > 0) {
        value += white * clickGain * (clickLeft / (sampleRate * 0.012));
        clickLeft--;
      }
    } else {
      // Cafe: broadband murmur breathing slowly + an occasional glass clink.
      const t = i / sampleRate;
      const breathe =
        0.65 +
        0.2 * Math.sin(2 * Math.PI * lfoA * t) +
        0.15 * Math.sin(2 * Math.PI * lfoB * t + 1.3);
      value = (lp1 * 0.9 + brown * 2.5) * breathe;
      if (i >= nextClick) {
        clickLeft = Math.floor(sampleRate * 0.09);
        clickGain = 0.12 + random() * 0.12;
        clickPhase = 2600 + random() * 1400;
        nextClick = i + Math.floor(sampleRate * (1.5 + random() * 4));
      }
      if (clickLeft > 0) {
        const env = clickLeft / (sampleRate * 0.09);
        value +=
          Math.sin((2 * Math.PI * clickPhase * i) / sampleRate) *
          clickGain *
          env *
          env;
        clickLeft--;
      }
    }
    out[i] = value;
  }
  // Normalize to a known peak so the mix gain below means something.
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < length; i++) out[i] /= peak;
  return out;
}

/** Linear resample of a mono buffer. */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  const length = Math.floor((input.length * toRate) / fromRate);
  const out = new Float32Array(length);
  const ratio = fromRate / toRate;
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function toMono(pcm: PcmWav): Float32Array {
  if (pcm.channels === 1) return pcm.samples;
  const frames = Math.floor(pcm.samples.length / pcm.channels);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < pcm.channels; c++) {
      sum += pcm.samples[f * pcm.channels + c];
    }
    out[f] = sum / pcm.channels;
  }
  return out;
}

/**
 * Optional real recording for a bed: `${IG_AMBIANCE_BASE_URL}/<kind>.wav`.
 * Returns mono samples at the target rate, or null to fall back to the
 * procedural bed.
 */
export async function loadBed(
  kind: Exclude<Ambiance, "none">,
  sampleRate: number,
): Promise<Float32Array | null> {
  const base = process.env.IG_AMBIANCE_BASE_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/${kind}.wav`);
    if (!res.ok) return null;
    const pcm = decodeWav(new Uint8Array(await res.arrayBuffer()));
    if (!pcm) return null;
    return resampleLinear(toMono(pcm), pcm.sampleRate, sampleRate);
  } catch {
    return null;
  }
}

/**
 * Lay a bed under the speech: a short bed-only lead-in and tail, gentle
 * fades, bed roughly −22 dB under the voice. Speech itself is untouched.
 */
export function mixBed(
  speech: PcmWav,
  bed: Float32Array,
  opts: { gain?: number; leadInSec?: number; tailSec?: number } = {},
): PcmWav {
  const gain = opts.gain ?? 0.08;
  const { sampleRate, channels } = speech;
  const lead = Math.floor(sampleRate * (opts.leadInSec ?? 0.25));
  const tail = Math.floor(sampleRate * (opts.tailSec ?? 0.45));
  const speechFrames = Math.floor(speech.samples.length / channels);
  const totalFrames = lead + speechFrames + tail;
  const out = new Float32Array(totalFrames * channels);
  const fade = Math.floor(sampleRate * 0.3);
  for (let f = 0; f < totalFrames; f++) {
    // Loop the bed if it's shorter than the note.
    const b = bed.length ? bed[f % bed.length] : 0;
    const env =
      f < fade
        ? f / fade
        : f > totalFrames - fade
          ? (totalFrames - f) / fade
          : 1;
    const bedSample = b * gain * env;
    for (let c = 0; c < channels; c++) {
      const s = f - lead;
      const voice =
        s >= 0 && s < speechFrames ? speech.samples[s * channels + c] : 0;
      out[f * channels + c] = voice + bedSample;
    }
  }
  return { sampleRate, channels, samples: out };
}

/**
 * Full pipeline: WAV bytes in, WAV bytes out with the chosen ambiance.
 * Undecodable input (non-PCM16) returns the original bytes untouched.
 */
export async function renderVoiceNote(
  speechWav: Uint8Array,
  ambiance: Ambiance,
): Promise<Uint8Array> {
  if (ambiance === "none") return speechWav;
  const speech = decodeWav(speechWav);
  if (!speech) return speechWav;
  const frames = Math.floor(speech.samples.length / speech.channels);
  const bedLength = frames + speech.sampleRate; // covers lead-in + tail
  const bed =
    (await loadBed(ambiance, speech.sampleRate)) ??
    generateBed(ambiance, speech.sampleRate, bedLength);
  return encodeWav(mixBed(speech, bed));
}
