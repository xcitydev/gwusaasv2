import type {
  AgendaItem,
  CoachState,
  MeetingAnalytics,
  MeetingNotes,
} from "./note-taker";

/**
 * Meeting Score, 0–100 — one number for "was this a good meeting?", built
 * only from things we already measure. Parts that don't apply (talk balance
 * in a one-speaker recording, agenda timing without an agenda) are dropped
 * and the rest re-weighted, so a solo voice memo isn't punished for having
 * nobody to talk to.
 */

export type ScorePart = {
  key: "balance" | "engagement" | "questions" | "monologue" | "outcomes" | "tone" | "agenda";
  label: string;
  /** 0–1 how well this part did. */
  value: number;
  /** Share of the final score this part carried. */
  weight: number;
  note: string;
};

export type MeetingScore = { score: number; breakdown: ScorePart[] };

const WEIGHTS: Record<ScorePart["key"], number> = {
  balance: 20,
  engagement: 15,
  questions: 15,
  monologue: 10,
  outcomes: 20,
  tone: 10,
  agenda: 10,
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** 1 at or past `good`, 0 at or past `bad`, linear between. */
const ramp = (x: number, bad: number, good: number) => clamp01((x - bad) / (good - bad));

export function scoreMeeting(input: {
  analytics: MeetingAnalytics | undefined | null;
  notes: MeetingNotes | undefined | null;
  durationSec: number;
  coachState?: CoachState | null;
  agenda?: AgendaItem[] | null;
}): MeetingScore | null {
  const { analytics, notes, durationSec } = input;
  if (!analytics || analytics.speakers.length === 0 || durationSec < 60) return null;
  const minutes = durationSec / 60;
  const speakers = analytics.speakers;
  const multi = speakers.length >= 2;
  const parts: Omit<ScorePart, "weight">[] = [];

  if (multi) {
    const top = speakers[0];
    parts.push({
      key: "balance",
      label: "Talk balance",
      value: ramp(top.share, 0.95, 0.6),
      note: `${top.name} spoke ${Math.round(top.share * 100)}% of the time`,
    });
    const turns = speakers.reduce((sum, s) => sum + s.turns, 0);
    const perMin = turns / minutes;
    parts.push({
      key: "engagement",
      label: "Back-and-forth",
      value: ramp(perMin, 0.2, 2),
      note: `${perMin.toFixed(1)} speaker changes a minute`,
    });
  }

  const questions = speakers.reduce((sum, s) => sum + s.questions, 0);
  const per10 = (questions / minutes) * 10;
  parts.push({
    key: "questions",
    label: "Questions",
    value: ramp(per10, 0, 3),
    note: `${questions} question${questions === 1 ? "" : "s"} asked`,
  });

  const longest = Math.max(...speakers.map((s) => s.longestMonologueSec));
  parts.push({
    key: "monologue",
    label: "Longest monologue",
    value: ramp(longest, 300, 90),
    note: `${Math.round(longest)}s at most without a break`,
  });

  if (notes) {
    const decisions = notes.decisions?.length ?? 0;
    const actions = notes.actionItems?.length ?? 0;
    parts.push({
      key: "outcomes",
      label: "Clear outcomes",
      value: (decisions > 0 ? 0.5 : 0) + (actions > 0 ? 0.5 : 0),
      note: `${decisions} decision${decisions === 1 ? "" : "s"}, ${actions} action item${actions === 1 ? "" : "s"}`,
    });
    const tone = notes.coaching?.sentiment;
    if (tone) {
      const value = { positive: 1, neutral: 0.7, mixed: 0.5, negative: 0.2 }[tone];
      parts.push({ key: "tone", label: "Tone", value, note: `Overall ${tone}` });
    }
  }

  const budgetMin = (input.agenda ?? []).reduce((sum, item) => sum + item.minutes, 0);
  if (budgetMin > 0) {
    const ratio = minutes / budgetMin;
    parts.push({
      key: "agenda",
      label: "On time",
      value: ramp(ratio, 1.6, 1.05),
      note: `${Math.round(minutes)} of ${budgetMin} planned minutes`,
    });
  }

  const totalWeight = parts.reduce((sum, p) => sum + WEIGHTS[p.key], 0);
  const breakdown: ScorePart[] = parts.map((p) => ({
    ...p,
    weight: WEIGHTS[p.key] / totalWeight,
  }));
  const score = Math.round(
    breakdown.reduce((sum, p) => sum + p.value * p.weight, 0) * 100,
  );
  return { score, breakdown };
}

/** Chip colour for a score. */
export function scoreClass(score: number): string {
  if (score >= 80) return "bg-emerald-500/15 text-emerald-400";
  if (score >= 60) return "bg-amber-500/15 text-amber-400";
  return "bg-red-500/15 text-red-400";
}
