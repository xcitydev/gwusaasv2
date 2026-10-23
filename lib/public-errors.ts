/**
 * Users must never learn which vendors power a feature. Every error that can
 * reach a user goes through `toPublicError`: vendor-branded or technical
 * messages become friendly, feature-specific copy, while messages we wrote
 * for users ("Add at least one lead", INSUFFICIENT_CREDITS…) pass through.
 *
 * Shared by Convex (sanitize + report to admins) and the client (last-line
 * scrub before a toast).
 */

export type ErrorArea =
  | "voice"
  | "generation"
  | "leads"
  | "email"
  | "meetings"
  | "transcription"
  | "ai"
  | "instagram"
  | "billing"
  | "account"
  | "general";

/** Vendor fingerprints → the product area they power. Order matters: first hit wins. */
const VENDORS: { vendor: string; area: ErrorArea; pattern: RegExp }[] = [
  { vendor: "Bland", area: "voice", pattern: /\bbland\b|bland\.ai/i },
  { vendor: "ElevenLabs", area: "voice", pattern: /eleven ?labs/i },
  { vendor: "Higgsfield", area: "generation", pattern: /higgsfield/i },
  { vendor: "fal", area: "generation", pattern: /\bfal(?:\.ai|\.media|-ai)?\b/i },
  { vendor: "Apify", area: "leads", pattern: /apify/i },
  { vendor: "Explorium", area: "leads", pattern: /explorium|vibe ?prospect/i },
  {
    vendor: "Instantly",
    area: "email",
    // "instantly" is also an English word — only match it used as a name.
    pattern: /instantly\.ai|\bInstantly(?: API)?(?: \d{3}|:)|\b(?:in|from|to|on|with) Instantly\b/,
  },
  { vendor: "Resend", area: "email", pattern: /resend\.com|\bResend(?: \d{3}|:)/ },
  {
    vendor: "Recall",
    area: "meetings",
    pattern: /recall\.ai|\bRecall(?: API)?(?: \d{3}|:)/,
  },
  { vendor: "Deepgram", area: "transcription", pattern: /deepgram/i },
  {
    vendor: "Anthropic",
    area: "ai",
    pattern: /anthropic|\bclaude\b|credit balance is too low|overloaded_error/i,
  },
  { vendor: "OpenAI", area: "ai", pattern: /openai/i },
  {
    vendor: "GoHighLevel",
    area: "instagram",
    pattern: /gohighlevel|highlevel|leadconnector|\bGHL\b/i,
  },
  { vendor: "Whop", area: "billing", pattern: /\bwhop\b/i },
  { vendor: "Clerk", area: "account", pattern: /\bclerk\b/i },
];

/** Plumbing leaks that mean "our bug or our config", never the user's fault. */
const TECHNICAL =
  /NOT_CONFIGURED|_API_KEY|API key|api_key|\benv(?:ironment)? var|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|socket hang up|Unexpected token|is not valid JSON|is not a function|Cannot read propert|undefined is not|\bstatus(?: code)? [45]\d\d\b|\b[45]\d\d (?:Bad|Unauthorized|Forbidden|Not Found|Internal|Service)|Internal Server Error|ArgumentValidationError|Request ID/i;

const AREA_COPY: Record<ErrorArea, string> = {
  voice: "We couldn't complete that voice request.",
  generation: "We couldn't finish this generation.",
  leads: "We couldn't complete that lead search.",
  email: "Something went wrong with email sending.",
  meetings: "We couldn't connect the meeting assistant.",
  transcription: "We couldn't transcribe that.",
  ai: "Our AI assistant couldn't finish that request.",
  instagram: "Something went wrong with the Instagram connection.",
  billing: "We couldn't complete that payment step.",
  account: "Something went wrong with your account session.",
  general: "Something went wrong on our side.",
};

const FOLLOW_UP =
  " Our team has been notified — please try again in a few minutes, or contact support if it keeps happening.";

/** Codes the client parses — never rewrite these. */
const PASSTHROUGH = /INSUFFICIENT_CREDITS|PLAN_REQUIRED|NOT_AUTHENTICATED/;

export type PublicError = {
  /** What the user should see. */
  message: string;
  /** True when the raw message was hidden and admins should hear about it. */
  hidden: boolean;
  vendor?: string;
  area: ErrorArea;
};

export function vendorOf(raw: string): { vendor: string; area: ErrorArea } | null {
  for (const v of VENDORS) if (v.pattern.test(raw)) return { vendor: v.vendor, area: v.area };
  return null;
}

export function friendlyCopy(area: ErrorArea): string {
  return AREA_COPY[area] + FOLLOW_UP;
}

/** Turn any raw error text into what a user may see. */
export function toPublicError(raw: string, fallbackArea: ErrorArea = "general"): PublicError {
  const text = raw.trim();
  if (PASSTHROUGH.test(text)) return { message: text, hidden: false, area: fallbackArea };
  const hit = vendorOf(text);
  if (hit) {
    return { message: friendlyCopy(hit.area), hidden: true, vendor: hit.vendor, area: hit.area };
  }
  if (!text || TECHNICAL.test(text)) {
    return { message: friendlyCopy(fallbackArea), hidden: true, area: fallbackArea };
  }
  return { message: text, hidden: false, area: fallbackArea };
}

/** Pull the human sentence out of a Convex client error (or any thrown value). */
export function extractErrorText(e: unknown): string {
  if (e && typeof e === "object" && "data" in e && typeof (e as { data: unknown }).data === "string") {
    return (e as { data: string }).data;
  }
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const after = raw.split(/Uncaught (?:Convex)?Error: /).pop() ?? raw;
  return after.split(/\n\s+at |\n\s*Called by client/)[0].trim();
}

/**
 * Client helper: the sentence to toast for a caught error. Vendor names and
 * stack noise never reach the screen; `fallback` covers empty errors.
 */
export function errorText(e: unknown, fallback = "Something went wrong. Please try again."): string {
  const text = extractErrorText(e).replace(/^NOT_CONFIGURED:\s*/, "");
  if (!text) return fallback;
  if (/^Server Error$/i.test(text)) return fallback;
  const pub = toPublicError(text);
  return pub.message;
}
