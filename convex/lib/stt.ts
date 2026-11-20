import type { Segment } from "./transcript";

/**
 * Speech-to-text with speaker labels, for uploaded meeting recordings.
 * Prefers Deepgram (reads the file straight from its URL); falls back to
 * ElevenLabs Scribe (needs the bytes, so it's capped). Provider names never
 * reach the user — errors here are worded generically.
 */

export class SttError extends Error {}

/** Scribe gets the whole file in memory — keep it well under action limits. */
const MAX_FALLBACK_BYTES = 300 * 1024 * 1024;

export function sttConfigured(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY || process.env.ELEVENLABS_API_KEY);
}

/** Merge consecutive same-speaker pieces into readable segments. */
function mergeRuns(pieces: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const piece of pieces) {
    const text = piece.text.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (
      last &&
      last.speaker === piece.speaker &&
      piece.start - last.end <= 2 &&
      last.text.length + text.length < 700
    ) {
      last.text = `${last.text} ${text}`.replace(/\s+([,.!?;:])/g, "$1");
      last.end = Math.max(last.end, piece.end);
    } else {
      out.push({ ...piece, text });
    }
  }
  return out;
}

async function deepgram(url: string): Promise<{ segments: Segment[]; durationSec: number }> {
  const res = await fetch(
    // filler_words keeps "um"/"uh" in the text (dropped by default) so the
    // Coaching page can count them on uploads.
    "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&diarize=true&utterances=true&detect_language=true&filler_words=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    },
  );
  if (res.status === 400 || res.status === 415) {
    throw new SttError("That file isn't a playable audio or video recording.");
  }
  if (!res.ok) throw new SttError(`Transcription failed (${res.status})`);
  const data = (await res.json()) as {
    metadata?: { duration?: number };
    results?: {
      utterances?: { start: number; end: number; speaker?: number; transcript: string }[];
    };
  };
  const segments = mergeRuns(
    (data.results?.utterances ?? []).map((u) => ({
      speaker: `Speaker ${(u.speaker ?? 0) + 1}`,
      start: u.start,
      end: u.end,
      text: u.transcript,
    })),
  );
  return { segments, durationSec: Math.round(data.metadata?.duration ?? segments.at(-1)?.end ?? 0) };
}

async function scribe(
  url: string,
  fileName: string,
): Promise<{ segments: Segment[]; durationSec: number }> {
  const file = await fetch(url);
  const size = Number(file.headers.get("content-length") ?? 0);
  if (size > MAX_FALLBACK_BYTES) {
    throw new SttError("That recording is too large to transcribe — keep uploads under 300 MB.");
  }
  const form = new FormData();
  form.append("file", await file.blob(), fileName || "recording");
  form.append("model_id", "scribe_v1");
  form.append("diarize", "true");
  form.append("timestamps_granularity", "word");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
    body: form,
  });
  if (!res.ok) throw new SttError(`Transcription failed (${res.status})`);
  const data = (await res.json()) as {
    words?: { text: string; start?: number; end?: number; type?: string; speaker_id?: string }[];
  };
  const speakerNames = new Map<string, string>();
  const pieces: Segment[] = [];
  for (const word of data.words ?? []) {
    if (word.type === "audio_event") continue;
    const id = word.speaker_id ?? "speaker_0";
    if (!speakerNames.has(id)) speakerNames.set(id, `Speaker ${speakerNames.size + 1}`);
    pieces.push({
      speaker: speakerNames.get(id)!,
      start: word.start ?? 0,
      end: word.end ?? word.start ?? 0,
      text: word.type === "spacing" ? " " : word.text,
    });
  }
  // Word-level → join words per speaker run (spacing tokens carry the gaps).
  const runs: Segment[] = [];
  for (const piece of pieces) {
    const last = runs[runs.length - 1];
    if (last && last.speaker === piece.speaker && piece.start - last.end <= 2) {
      last.text += piece.text;
      last.end = Math.max(last.end, piece.end);
    } else if (piece.text.trim()) {
      runs.push({ ...piece });
    }
  }
  const segments = mergeRuns(runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, " ") })));
  return { segments, durationSec: Math.round(segments.at(-1)?.end ?? 0) };
}

/** Transcribe a stored recording, speaker-labelled ("Speaker 1", …). */
export async function transcribeRecording(
  url: string,
  fileName: string,
): Promise<{ segments: Segment[]; durationSec: number }> {
  if (process.env.DEEPGRAM_API_KEY) return await deepgram(url);
  if (process.env.ELEVENLABS_API_KEY) return await scribe(url, fileName);
  throw new SttError("NOT_CONFIGURED: Uploads need a transcription engine — ask an admin.");
}
