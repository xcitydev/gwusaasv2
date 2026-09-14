/**
 * Bland AI adapter — powers both the inbound AI receptionist and the
 * outbound lead qualifier. Every call is a no-op until BLAND_API_KEY is set
 * on the Convex deployment. Docs: https://docs.bland.ai
 */

const BASE = "https://api.bland.ai/v1";

export function blandConfigured(): boolean {
  return Boolean(process.env.BLAND_API_KEY);
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const key = process.env.BLAND_API_KEY;
  if (!key) throw new Error("NOT_CONFIGURED: BLAND_API_KEY is not set");
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Bland ${res.status} on ${path}: ${text}`);
    let detail = "";
    try {
      const parsed = JSON.parse(text) as { message?: string; errors?: { message?: string }[] };
      detail = String(parsed.message ?? parsed.errors?.[0]?.message ?? "");
    } catch {
      detail = text.slice(0, 200);
    }
    throw new Error(`Bland ${res.status}: ${detail || "request failed"}`);
  }
  return (await res.json()) as T;
}

/** Outbound qualification call to one lead. */
export async function sendCall(args: {
  phoneNumber: string;
  task: string;
  voice?: string;
  webhookUrl?: string;
  metadata?: Record<string, string>;
  /** Hard cap on call length (minutes) — bounds per-call cost. */
  maxDurationMin?: number;
  backgroundTrack?: string;
}): Promise<string> {
  const result = await call<{ call_id: string }>("/calls", {
    method: "POST",
    body: {
      phone_number: args.phoneNumber,
      task: args.task,
      voice: args.voice ?? "maya",
      record: true,
      webhook: args.webhookUrl,
      metadata: args.metadata,
      max_duration: args.maxDurationMin ?? 5,
      ...(args.backgroundTrack && { background_track: args.backgroundTrack }),
      // Their 500ms default silence-wait reads as lag; 120ms feels live.
      interruption_threshold: 120,
    },
  });
  return result.call_id;
}

export type BlandVoice = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  service: string;
  public: boolean;
};

/** All voices the account can use — curated V3 voices are the good ones. */
export async function listVoices(): Promise<BlandVoice[]> {
  const result = await call<{ voices?: BlandVoice[] }>("/voices");
  return result.voices ?? [];
}

/**
 * Short spoken sample of a voice, as a WAV (base64). Billed per character
 * (~$0.001 minimum) — trivial, and we cache client-side per voice.
 */
export async function ttsPreview(voiceId: string, text: string): Promise<string> {
  const res = await fetch("https://api.bland.ai/v2/tts", {
    method: "POST",
    headers: {
      authorization: process.env.BLAND_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice: voiceId,
      audio: { container: "wav" },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bland TTS ${res.status}: ${body.slice(0, 200)}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type BlandCallSummary = {
  call_id: string;
  to?: string;
  from?: string;
  inbound?: boolean;
  completed?: boolean;
};

/** Recent calls on the account — used to sweep for inbound calls whose
 *  webhook we missed (they carry no convexCallId, unlike calls we place). */
export async function listRecentCalls(limit = 50): Promise<BlandCallSummary[]> {
  const result = await call<{ calls?: BlandCallSummary[] }>(
    `/calls?limit=${limit}&ascending=false`,
  );
  return result.calls ?? [];
}

/** Transcript + duration for a finished call (works for web sessions too). */
export async function getCallDetails(callId: string): Promise<{
  transcript: string;
  durationSec: number;
  completed: boolean;
}> {
  const result = await call<{
    concatenated_transcript?: string;
    corrected_duration?: number | string;
    call_length?: number;
    completed?: boolean;
  }>(`/calls/${callId}`);
  const corrected = Number(result.corrected_duration);
  return {
    transcript: result.concatenated_transcript ?? "",
    durationSec: Math.round(
      Number.isFinite(corrected) && corrected > 0
        ? corrected
        : (result.call_length ?? 0) * 60,
    ),
    completed: result.completed ?? true,
  };
}

/** Buy a phone number ($15/mo, billed to the platform's Bland account). */
/** Current prepaid balance on the Bland account (funds numbers + talk time). */
export async function getBalance(): Promise<number> {
  const me = await call<{ billing?: { current_balance?: number } }>("/me");
  return me.billing?.current_balance ?? 0;
}

export type AvailableNumber = {
  phone_number: string;
  friendly_name: string;
  location: string;
};

/**
 * Live inventory the user can pick from before buying. Undocumented but real:
 * GET /v1/available_numbers is what Bland's own dashboard uses (verified
 * 2026-09-09 — returns friendly_name + location per number).
 */
export async function listAvailableNumbers(
  areaCode?: string,
): Promise<AvailableNumber[]> {
  const qs = areaCode ? `?area_code=${encodeURIComponent(areaCode)}` : "";
  const result = await call<{ phoneNumbers?: AvailableNumber[] }>(
    `/available_numbers${qs}`,
  );
  return (result.phoneNumbers ?? []).filter((n) => n.phone_number);
}

export async function purchaseNumber(opts: {
  areaCode?: string;
  phoneNumber?: string;
  /** Platform admins see the real ops reason; users get a generic message. */
  revealOpsErrors?: boolean;
}): Promise<string> {
  // Numbers bill as a $15/mo SUBSCRIPTION to the card stored on the Bland
  // account (verified 2026-09-13 — "Subscription is not active" without one).
  // The prepaid balance only funds talk time, so it must never block a
  // purchase; just flag it when it's running low.
  const balance = await getBalance();
  if (balance < 10) {
    console.error(
      `Bland prepaid balance is low ($${balance.toFixed(2)}) — inbound talk time draws from it. Top up at app.bland.ai.`,
    );
  }
  const generic =
    "Number purchasing is temporarily unavailable — our team is on it. Please try again soon.";
  const ownedNumbers = async (): Promise<string[]> => {
    const r = await call<{
      inbound_numbers?: { phone_number?: string; number?: string }[];
    }>("/inbound");
    return (r.inbound_numbers ?? [])
      .map((n) => n.phone_number ?? n.number)
      .filter((n): n is string => Boolean(n));
  };

  try {
    const before = await ownedNumbers();
    // Official endpoint: POST /v1/inbound/purchase (phone_number overrides
    // area_code and buys that exact number).
    const result = await call<Record<string, unknown>>("/inbound/purchase", {
      method: "POST",
      body: {
        country_code: "US",
        ...(opts.areaCode && { area_code: opts.areaCode }),
        ...(opts.phoneNumber && { phone_number: opts.phoneNumber }),
      },
    });
    // The response shape varies (2026-09-13: a successful card-backed
    // purchase came back WITHOUT a top-level phone_number). Try the known
    // fields, then reconcile against the account's number list — the
    // purchase may have succeeded regardless of what the body says.
    const data = (result.data ?? {}) as Record<string, unknown>;
    for (const candidate of [
      result.phone_number,
      result.number,
      data.phone_number,
      data.number,
    ]) {
      if (typeof candidate === "string" && candidate) return candidate;
    }
    console.error(
      "Unrecognized Bland purchase response:",
      JSON.stringify(result).slice(0, 600),
    );
    const after = await ownedNumbers();
    if (opts.phoneNumber && after.includes(opts.phoneNumber)) {
      return opts.phoneNumber;
    }
    const fresh = after.find((n) => !before.includes(n));
    if (fresh) return fresh;
    throw new Error(
      "Bland accepted the purchase but no new number shows on the account yet — check app.bland.ai before retrying so you aren't billed twice.",
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (/subscription is not active/i.test(raw)) {
      console.error(
        "Bland refused the number purchase: no active payment method on the platform's Bland account. Add a card at app.bland.ai → Billing.",
      );
      throw new Error(
        opts.revealOpsErrors
          ? "[Admin] The platform's Bland account has no card on file — numbers bill as a $15/mo subscription to the stored payment method (the prepaid balance only covers talk time). Add a card at app.bland.ai → Billing, then retry. Regular users see a generic message."
          : generic,
      );
    }
    if (/no numbers available|not found/i.test(raw)) {
      throw new Error(
        opts.phoneNumber
          ? "That number was just taken — refresh the list and pick another."
          : "No numbers in stock for that search — try another area code.",
      );
    }
    throw error;
  }
}

/**
 * Web agents power "Test in browser": a throwaway agent with the current
 * prompt, spoken to over WebRTC via bland-client-js-sdk — no phone, no call
 * charges beyond web-session usage.
 */
export async function createWebAgent(args: {
  prompt: string;
  voice?: string;
  firstSentence?: string;
  webhookUrl?: string;
  backgroundTrack?: string;
}): Promise<string> {
  const result = await call<{ agent?: { agent_id?: string }; agent_id?: string }>(
    "/agents",
    {
      method: "POST",
      body: {
        prompt: args.prompt,
        voice: args.voice ?? "maya",
        ...(args.firstSentence && { first_sentence: args.firstSentence }),
        ...(args.webhookUrl && { webhook: args.webhookUrl }),
        ...(args.backgroundTrack && { background_track: args.backgroundTrack }),
        // Bland waits this long after the caller stops before replying —
        // their default (500ms) reads as lag. Lower = snappier.
        interruption_threshold: 120,
      },
    },
  );
  const agentId = result.agent?.agent_id ?? result.agent_id;
  if (!agentId) throw new Error("Bland returned no agent id");
  return agentId;
}

/** Single-use browser session token for a web agent. */
export async function authorizeWebAgent(agentId: string): Promise<string> {
  const result = await call<{ token?: string }>(`/agents/${agentId}/authorize`, {
    method: "POST",
    body: {},
  });
  if (!result.token) throw new Error("Bland returned no session token");
  return result.token;
}

/** Point an owned number's inbound handling at the receptionist prompt. */
export async function configureInbound(args: {
  phoneNumber: string;
  prompt: string;
  voice?: string;
  firstSentence?: string;
  webhookUrl?: string;
  backgroundTrack?: string;
}): Promise<void> {
  await call(`/inbound/${encodeURIComponent(args.phoneNumber)}`, {
    method: "POST",
    body: {
      prompt: args.prompt,
      voice: args.voice ?? "maya",
      first_sentence: args.firstSentence,
      webhook: args.webhookUrl,
      record: true,
      ...(args.backgroundTrack && { background_track: args.backgroundTrack }),
      interruption_threshold: 120,
    },
  });
}
