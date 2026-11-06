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

/**
 * True for a Zoom join link with no embedded passcode (?pwd=…). Most Zoom
 * meetings require one, and the bot can only supply it through the link —
 * a bare /j/<id> link gets the bot turned away at the door.
 */
export function zoomLinkMissingPasscode(url: string): boolean {
  if (detectPlatform(url) !== "zoom") return false;
  try {
    const parsed = new URL(url.trim());
    return /^\/j\//.test(parsed.pathname) && !parsed.searchParams.get("pwd");
  } catch {
    return false;
  }
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

// ── Why a meeting wasn't recorded (Incomplete tab) ──────────────────────

export type FailureAction = "retry" | "topup" | null;

export const FAILURE_CODES: Record<
  string,
  { title: string; fix: string; action: FailureAction }
> = {
  not_admitted: {
    title: "Not let in",
    fix: "Nobody admitted the bot. Ask the host to let “Notetaker” in, or turn off the waiting room for recorded meetings.",
    action: "retry",
  },
  waiting_room_timeout: {
    title: "Stuck in the waiting room",
    fix: "The bot waited 15 minutes without being admitted. Admit it when it knocks, or disable the waiting room.",
    action: "retry",
  },
  kicked: {
    title: "Removed from the call",
    fix: "Someone removed or declined the bot. If that was a mistake, send it again.",
    action: "retry",
  },
  nobody_joined: {
    title: "Nobody showed up",
    fix: "Nobody else joined, so the bot left. Nothing to fix unless the meeting moved — check the time and link.",
    action: null,
  },
  permission_denied: {
    title: "Recording declined",
    fix: "The host declined the recording request. In Zoom, the host must allow participants to record (or approve the bot's request).",
    action: "retry",
  },
  link_invalid: {
    title: "Bad meeting link",
    fix: "The link was invalid, expired or the meeting didn't exist. Paste the current invite link.",
    action: "retry",
  },
  password_missing: {
    title: "Missing passcode",
    fix: "In Zoom use “Copy invite link” so the link ends in ?pwd=…, then send the bot again.",
    action: "retry",
  },
  sign_in_required: {
    title: "Sign-in or registration required",
    fix: "This meeting only admits signed-in or registered people. Allow guests for meetings you want recorded.",
    action: null,
  },
  meeting_locked: {
    title: "Meeting locked or full",
    fix: "The meeting was locked or at capacity when the bot arrived.",
    action: "retry",
  },
  no_credits: {
    title: "Out of credits",
    fix: "There weren't enough credits to record. Top up, then press Record on the event.",
    action: "topup",
  },
  timeout: {
    title: "Timed out",
    fix: "The meeting never finished from the bot's point of view. If this repeats, contact support.",
    action: null,
  },
  media_expired: {
    title: "Recording expired",
    fix: "The recording expired before it was processed.",
    action: null,
  },
  send_failed: {
    title: "Couldn't send the bot",
    fix: "The bot couldn't be sent to this meeting. Check the link and try again.",
    action: "retry",
  },
  other: {
    title: "Didn't record",
    fix: "The bot couldn't record this meeting.",
    action: "retry",
  },
};

/** The bot provider's failure sub-code → our failure code. */
export function failureCodeFor(subCode: string | null | undefined): string {
  switch (subCode) {
    case "timeout_exceeded_waiting_room":
      return "waiting_room_timeout";
    case "bot_kicked_from_waiting_room":
    case "bot_kicked_from_call":
      return "kicked";
    case "timeout_exceeded_noone_joined":
    case "meeting_not_started":
      return "nobody_joined";
    case "timeout_exceeded_recording_permission_denied":
      return "permission_denied";
    case "meeting_not_found":
    case "meeting_link_invalid":
    case "meeting_link_expired":
      return "link_invalid";
    case "meeting_password_incorrect":
      return "password_missing";
    case "meeting_requires_registration":
    case "meeting_requires_sign_in":
      return "sign_in_required";
    case "meeting_locked":
    case "meeting_full":
      return "meeting_locked";
    default:
      return "other";
  }
}

// ── Pre-meeting brief ───────────────────────────────────────────────────

export type MeetingBrief = {
  status: "ready" | "failed" | "skipped";
  generatedAt: number;
  /** One line: what this meeting is and where things stand. */
  headline?: string;
  people?: { name: string; who: string; history: string; openItems: string[] }[];
  openPromises?: string[];
  suggestedAgenda?: string[];
  questionsToAsk?: string[];
  watchOuts?: string[];
  /** How much we found — shown as "from 2 leads, 3 replies, 1 meeting". */
  sources?: { leads: number; replies: number; meetings: number; dms: number };
  /** Why it failed / was skipped (user-safe wording). */
  reason?: string;
};

// ── Calendar auto-join rules ────────────────────────────────────────────

export type AutoJoinMode = "all" | "hosting" | "manual";

export const AUTO_JOIN_MODES: Record<AutoJoinMode, { label: string; hint: string }> = {
  hosting: {
    label: "Only meetings I host",
    hint: "Joins events you created or organise.",
  },
  all: {
    label: "Every meeting with a link",
    hint: "Joins every calendar event that has a Zoom, Meet or Teams link.",
  },
  manual: {
    label: "I pick which ones",
    hint: "Nothing joins on its own — flip Record on the events you want.",
  },
};

/** What we can tell about one calendar event from the provider's payload. */
export type EventFacts = {
  /** null = the payload doesn't say. */
  isOrganizer: boolean | null;
  isRecurring: boolean;
  /** Lower-cased invitee emails, rooms/resources left out. */
  attendeeEmails: string[];
};

export type JoinRules = {
  autoJoin: AutoJoinMode;
  joinInternalOnly: boolean;
  internalDomains: string[];
  skipRecurring: boolean;
};

/** Free mail providers — never a company's "internal" domain. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "zoho.com",
]);

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

/**
 * Why the bot should NOT auto-join this event, or null when it should.
 * Only consulted for auto-join — a manual Record toggle always wins.
 */
export function autoJoinBlock(rules: JoinRules, facts: EventFacts): string | null {
  if (rules.autoJoin === "manual") return "Auto-join is off";
  // Unknown organizer counts as "not you": better to miss one than to
  // drop a bot into someone else's meeting.
  if (rules.autoJoin === "hosting" && facts.isOrganizer !== true) {
    return "Not hosted by you";
  }
  if (rules.skipRecurring && facts.isRecurring) return "Recurring meeting";
  if (rules.joinInternalOnly) {
    const internal = new Set(rules.internalDomains.map((d) => d.toLowerCase()));
    if (internal.size === 0) return "Add your company domain in settings";
    if (facts.attendeeEmails.some((email) => !internal.has(emailDomain(email)))) {
      return "Has outside guests";
    }
  }
  return null;
}

/** Output languages offered for notes (transcription always auto-detects). */
export const OUTPUT_LANGUAGES: Record<string, string> = {
  auto: "Same as the meeting",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  ar: "Arabic",
  hi: "Hindi",
  ja: "Japanese",
  zh: "Chinese",
  ru: "Russian",
};

// ── Agenda Coach ────────────────────────────────────────────────────────

export type AgendaItem = { title: string; minutes: number };

export type CoachTalk = { name: string; sec: number; share: number };

/** The live verdict the coach keeps on the meeting row. */
export type CoachState = {
  currentItem: number | null;
  itemLog: { index: number; startedSec: number; endedSec: number | null }[];
  elapsedSec: number;
  topic: string | null;
  offTopic: boolean;
  suggestion: string | null;
  nudge: string | null;
  nudgeKind: "overrun" | "drift" | "balance" | "next" | null;
  talk: CoachTalk[];
  updatedAt: number;
  lastChatNudgeAt: number | null;
  lastBalanceNudgeAt: number | null;
  overrunNotifiedPct: number;
  tickScheduled: boolean;
  ticks: number;
  tileOn: boolean;
};

/** Platforms where Recall bots can post chat / show a camera feed. */
export const COACH_CHAT_PLATFORMS = ["zoom", "google_meet", "microsoft_teams", "slack"];
export const COACH_TILE_PLATFORMS = ["zoom", "google_meet", "microsoft_teams", "webex"];

export type TaskRoutingResult = {
  provider: "trello" | "asana" | "webhook";
  ok: boolean;
  created: number;
  error?: string;
  links: { task: string; url: string | null }[];
};

export type TaskRouting = { at: number; results: TaskRoutingResult[] };

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
  /** Absent on notes written before meeting types existed. */
  meetingType?: string;
  templateSections?: { heading: string; items: string[] }[];
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
  /** Absent on meetings analysed before coaching existed. */
  fillerWords?: number;
  fillerPerMin?: number;
};

/** A moment worth replaying on the Coaching page. */
export type CoachingMoment = {
  speaker: string;
  atSec: number;
  kind: "filler" | "fast" | "slow";
  /** The filler words, or the pace in wpm. */
  detail: string;
};

export type MeetingAnalytics = {
  totalTalkSec: number;
  speakers: SpeakerStats[];
  moments?: CoachingMoment[];
};

/** Comfortable speaking pace for meetings (words per minute). */
export const PACE_TARGET = { min: 130, max: 170 } as const;
/** Filler words per minute of your own talk time above this is "high". */
export const FILLER_TARGET_PER_MIN = 3;

/** Notes as Markdown — for the Copy button and plain-text exports. */
export function notesToMarkdown(title: string, notes: MeetingNotes): string {
  const lines: string[] = [`# ${title}`, "", notes.summary, ""];
  const list = (heading: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`## ${heading}`, ...items.map((item) => `- ${item}`), "");
  };
  for (const section of notes.templateSections ?? []) {
    list(section.heading, section.items);
  }
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
