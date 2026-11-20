import {
  formatClock,
  PACE_TARGET,
  type MeetingAnalytics,
  type SpeakerStats,
} from "../../lib/note-taker";

/**
 * Pure transcript toolkit for the AI Note Taker: Recall's word-level
 * transcript → readable speaker segments, talk-time analytics, search
 * snippets. No I/O — unit-testable without a Recall key.
 */

type RecallTimestamp = { relative?: number | null; absolute?: string | null };

export type RecallTranscriptEntry = {
  participant?: {
    id?: number | null;
    name?: string | null;
    is_host?: boolean | null;
    email?: string | null;
  } | null;
  words?: {
    text?: string | null;
    start_timestamp?: RecallTimestamp | null;
    end_timestamp?: RecallTimestamp | null;
  }[];
};

export type Segment = {
  speaker: string;
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
  text: string;
};

/** Same speaker resuming within this gap continues the segment. */
const MERGE_GAP_SEC = 2;
/** …unless the segment is already this long (keeps paragraphs readable). */
const MAX_SEGMENT_CHARS = 700;

function speakerName(entry: RecallTranscriptEntry): string {
  const name = entry.participant?.name?.trim();
  if (name) return name;
  const id = entry.participant?.id;
  return id === null || id === undefined ? "Speaker" : `Speaker ${id}`;
}

export function toSegments(entries: RecallTranscriptEntry[]): Segment[] {
  const segments: Segment[] = [];
  for (const entry of entries) {
    const words = (entry.words ?? []).filter((w) => w.text && w.text.trim());
    if (words.length === 0) continue;
    const text = words
      .map((w) => String(w.text).trim())
      .join(" ")
      .replace(/\s+([,.!?;:])/g, "$1");
    const start = Number(words[0].start_timestamp?.relative ?? 0) || 0;
    const lastWord = words[words.length - 1];
    const end =
      Number(
        lastWord.end_timestamp?.relative ??
          lastWord.start_timestamp?.relative ??
          start,
      ) || start;
    const speaker = speakerName(entry);
    const previous = segments[segments.length - 1];
    if (
      previous &&
      previous.speaker === speaker &&
      start - previous.end <= MERGE_GAP_SEC &&
      previous.text.length + text.length < MAX_SEGMENT_CHARS
    ) {
      previous.text = `${previous.text} ${text}`;
      previous.end = Math.max(previous.end, end);
    } else {
      segments.push({ speaker, start, end: Math.max(end, start), text });
    }
  }
  return segments.sort((a, b) => a.start - b.start);
}

/** Everyone who spoke, with the email when the platform exposed one. */
export function participantsOf(
  entries: RecallTranscriptEntry[],
): { name: string; email?: string }[] {
  const seen = new Map<string, { name: string; email?: string }>();
  for (const entry of entries) {
    const name = speakerName(entry);
    const email = entry.participant?.email?.trim() || undefined;
    const existing = seen.get(name);
    if (!existing) seen.set(name, { name, ...(email && { email }) });
    else if (email && !existing.email) existing.email = email;
  }
  return [...seen.values()];
}

/** "[12:04] Dana: …" lines — what the AI reads and Ask AI cites. */
export function flattenTranscript(segments: Segment[]): string {
  return segments
    .map((s) => `[${formatClock(s.start)}] ${s.speaker}: ${s.text}`)
    .join("\n");
}

export function chunkSegments(segments: Segment[], size = 150): Segment[][] {
  const chunks: Segment[][] = [];
  for (let i = 0; i < segments.length; i += size) {
    chunks.push(segments.slice(i, i + size));
  }
  return chunks;
}

/**
 * Filler words — deliberately conservative: "like", "so", "right" have too
 * many real uses to count without a language model.
 */
const FILLER = /\b(u+m+|u+h+m*|e+r+m+|h+m+|you know|i mean|kind of|sort of|basically|literally)\b/gi;

export function fillersIn(text: string): string[] {
  return (text.match(FILLER) ?? []).map((w) => w.toLowerCase());
}

/** Segments long enough to judge pace on. */
const PACE_MIN_SEC = 8;
const MAX_MOMENTS_PER_KIND = 20;

export function computeAnalytics(segments: Segment[]): MeetingAnalytics {
  const bySpeaker = new Map<string, SpeakerStats>();
  const moments: NonNullable<MeetingAnalytics["moments"]> = [];
  const momentCount = { filler: 0, fast: 0, slow: 0 };
  let previousSpeaker: string | null = null;
  for (const segment of segments) {
    const stats = bySpeaker.get(segment.speaker) ?? {
      name: segment.speaker,
      talkSec: 0,
      share: 0,
      words: 0,
      wordsPerMinute: 0,
      turns: 0,
      questions: 0,
      longestMonologueSec: 0,
      fillerWords: 0,
      fillerPerMin: 0,
    };
    const length = Math.max(0, segment.end - segment.start);
    const words = segment.text.split(/\s+/).filter(Boolean).length;
    stats.talkSec += length;
    stats.words += words;
    stats.questions += (segment.text.match(/\?/g) ?? []).length;
    const fillers = fillersIn(segment.text);
    stats.fillerWords = (stats.fillerWords ?? 0) + fillers.length;
    if (fillers.length >= 2 && momentCount.filler < MAX_MOMENTS_PER_KIND) {
      momentCount.filler++;
      moments.push({
        speaker: segment.speaker,
        atSec: Math.floor(segment.start),
        kind: "filler",
        detail: [...new Set(fillers)].join(", "),
      });
    }
    if (length >= PACE_MIN_SEC) {
      const wpm = Math.round(words / (length / 60));
      const kind = wpm > PACE_TARGET.max + 20 ? "fast" : wpm < PACE_TARGET.min - 30 ? "slow" : null;
      if (kind && momentCount[kind] < MAX_MOMENTS_PER_KIND) {
        momentCount[kind]++;
        moments.push({
          speaker: segment.speaker,
          atSec: Math.floor(segment.start),
          kind,
          detail: `${wpm} wpm`,
        });
      }
    }
    stats.longestMonologueSec = Math.max(stats.longestMonologueSec, length);
    if (previousSpeaker !== segment.speaker) stats.turns += 1;
    previousSpeaker = segment.speaker;
    bySpeaker.set(segment.speaker, stats);
  }
  const speakers = [...bySpeaker.values()];
  const totalTalkSec = speakers.reduce((sum, s) => sum + s.talkSec, 0);
  for (const stats of speakers) {
    // Shares come from the exact seconds — rounding first makes them drift
    // off 100%.
    stats.share = totalTalkSec > 0 ? stats.talkSec / totalTalkSec : 0;
    stats.wordsPerMinute =
      stats.talkSec >= 5 ? Math.round(stats.words / (stats.talkSec / 60)) : 0;
    stats.fillerPerMin =
      stats.talkSec >= 30
        ? Math.round(((stats.fillerWords ?? 0) / (stats.talkSec / 60)) * 10) / 10
        : 0;
    stats.talkSec = Math.round(stats.talkSec);
    stats.longestMonologueSec = Math.round(stats.longestMonologueSec);
  }
  speakers.sort((a, b) => b.talkSec - a.talkSec);
  return { totalTalkSec: Math.round(totalTalkSec), speakers, moments };
}

/** A short window of text around the first search hit. */
export function snippetAround(text: string, term: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const first = term.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const at = first ? flat.toLowerCase().indexOf(first) : -1;
  if (at === -1) return flat.slice(0, 140);
  const start = Math.max(0, at - 50);
  const end = Math.min(flat.length, at + 110);
  return (
    (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "")
  );
}
