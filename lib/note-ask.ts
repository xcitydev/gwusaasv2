/**
 * Ask across meetings — pure helpers shared by the Convex action and the UI.
 * The model cites meetings as [M3] or a moment as [M3 12:04]; those labels
 * map back to real meeting ids so the UI can link to the exact second.
 */

export type AskScope =
  | { kind: "all" }
  | { kind: "type"; id: string }
  | { kind: "folder"; id: string }
  | { kind: "meeting"; id: string };

export type AskCitation = {
  /** "M3" or "M3 12:04" — exactly as written in the answer. */
  ref: string;
  meetingId: string;
  title: string;
  atSec?: number;
};

const CITATION = /\[(M\d+)(?:\s+((?:\d{1,2}:)?\d{1,2}:\d{2}))?\]/g;

function clockToSec(clock: string): number {
  return clock
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

/** Every [M#] / [M# mm:ss] in the answer that points at a real meeting. */
export function parseCitations(
  answer: string,
  meetings: Record<string, { meetingId: string; title: string }>,
): AskCitation[] {
  const seen = new Set<string>();
  const citations: AskCitation[] = [];
  for (const match of answer.matchAll(CITATION)) {
    const label = match[1];
    const meeting = meetings[label];
    if (!meeting) continue;
    const ref = match[2] ? `${label} ${match[2]}` : label;
    if (seen.has(ref)) continue;
    seen.add(ref);
    citations.push({
      ref,
      meetingId: meeting.meetingId,
      title: meeting.title,
      ...(match[2] && { atSec: clockToSec(match[2]) }),
    });
  }
  return citations;
}

/** Split an answer into text and citation tokens for rendering. */
export function splitCitations(answer: string): (string | { ref: string })[] {
  const out: (string | { ref: string })[] = [];
  let last = 0;
  for (const match of answer.matchAll(CITATION)) {
    const at = match.index ?? 0;
    if (at > last) out.push(answer.slice(last, at));
    out.push({ ref: match[2] ? `${match[1]} ${match[2]}` : match[1] });
    last = at + match[0].length;
  }
  if (last < answer.length) out.push(answer.slice(last));
  return out;
}

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have how i if in " +
    "into is it its last me my of on or our so that the their them then there these they this " +
    "to was we were what when where which who why will with would you your about any all " +
    "meeting meetings call calls said say tell week month did decide decided us get got"
  ).split(" "),
);

/** Keyword fallback when the rewrite model is unavailable. */
export function fallbackKeywords(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 6);
}

/** Starter prompts; {slots} are selected for typing over when inserted. */
export const ASK_PROMPTS = [
  "What are the major takeaways from last week's meetings?",
  "What did we decide about {topic}?",
  "List every open action item, grouped by owner.",
  "What are my next steps with {client}?",
  "What objections came up on sales calls this month?",
  "Write a status update from the last month of {project} meetings.",
];
