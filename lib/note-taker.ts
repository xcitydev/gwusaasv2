/**
 * Shared AI Note Taker constants — the UI and the Convex backend both import
 * these, so status labels, platform detection and clock formatting live in
 * exactly one place.
 */

export const MEETING_STATUSES = {
  scheduled: { label: "Scheduled", className: "bg-sky-500/15 text-sky-400" },
  joining: { label: "Joining…", className: "bg-amber-500/15 text-amber-400" },
  waiting_room: {
    label: "Waiting to be admitted",
    className: "bg-amber-500/15 text-amber-400",
  },
  recording: { label: "Recording", className: "bg-red-500/15 text-red-400" },
  processing: {
    label: "Writing notes…",
    className: "bg-primary/15 text-primary",
  },
  done: { label: "Ready", className: "bg-emerald-500/15 text-emerald-400" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
  cancelled: {
    label: "Cancelled",
    className: "bg-secondary text-muted-foreground",
  },
} as const;

export type MeetingStatus = keyof typeof MEETING_STATUSES;

/** A bot is out there (or about to be) — these get live polling + a Stop button. */
export const ACTIVE_STATUSES: MeetingStatus[] = [
  "joining",
  "waiting_room",
  "recording",
  "processing",
];

export const MEETING_PLATFORMS = {
  zoom: "Zoom",
  google_meet: "Google Meet",
  microsoft_teams: "Microsoft Teams",
  webex: "Webex",
  goto_meeting: "GoTo Meeting",
  slack: "Slack huddle",
} as const;

export type MeetingPlatform = keyof typeof MEETING_PLATFORMS;

/** Which supported platform a link belongs to; null = not a meeting link. */
export function detectPlatform(url: string): MeetingPlatform | null {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "zoom.us" || host.endsWith(".zoom.us") || host.endsWith(".zoomgov.com")) {
    return "zoom";
  }
  if (host === "meet.google.com") return "google_meet";
  if (
    host === "teams.microsoft.com" ||
    host === "teams.live.com" ||
    host.endsWith(".teams.microsoft.us")
  ) {
    return "microsoft_teams";
  }
  if (host.endsWith(".webex.com")) return "webex";
  if (host.endsWith("gotomeeting.com") || host === "meet.goto.com") {
    return "goto_meeting";
  }
  if (host === "app.slack.com") return "slack";
  return null;
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** 3725 → "1h 2m"; 540 → "9m"; 40 → "40s". */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** What the AI pass produces for every meeting. */
export type MeetingNotes = {
  title: string;
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: { task: string; owner: string | null; due: string | null }[];
  openQuestions: string[];
  chapters: { title: string; startSec: number; summary: string }[];
  followUpEmail: { subject: string; body: string };
  coaching: {
    sentiment: "positive" | "neutral" | "mixed" | "negative";
    highlights: string[];
    suggestions: string[];
  };
};

export type SpeakerStats = {
  name: string;
  talkSec: number;
  /** Share of all talk time, 0–1. */
  share: number;
  words: number;
  wordsPerMinute: number;
  turns: number;
  questions: number;
  longestMonologueSec: number;
};

export type MeetingAnalytics = {
  totalTalkSec: number;
  speakers: SpeakerStats[];
};

/** Notes as Markdown — for the Copy button and plain-text exports. */
export function notesToMarkdown(title: string, notes: MeetingNotes): string {
  const lines: string[] = [`# ${title}`, "", notes.summary, ""];
  const list = (heading: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`## ${heading}`, ...items.map((item) => `- ${item}`), "");
  };
  list("Key points", notes.keyPoints);
  list("Decisions", notes.decisions);
  if (notes.actionItems.length > 0) {
    lines.push(
      "## Action items",
      ...notes.actionItems.map(
        (a) =>
          `- [ ] ${a.task}${a.owner ? ` — ${a.owner}` : ""}${a.due ? ` (due ${a.due})` : ""}`,
      ),
      "",
    );
  }
  list("Open questions", notes.openQuestions);
  return lines.join("\n").trim() + "\n";
}
