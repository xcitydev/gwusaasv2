/**
 * ElevenLabs Agents adapter — the second call engine, next to Bland. Powers
 * the receptionist (inbound, on a Twilio number imported into ElevenLabs),
 * the qualifier (outbound through that number) and browser tests (WebRTC
 * via a conversation token). Same disclosures as Bland: every greeting /
 * opening line is built by lib/bland's inboundGreeting/outboundDisclosure.
 * Docs: https://elevenlabs.io/docs/api-reference (convai endpoints).
 */

const BASE = "https://api.elevenlabs.io/v1/convai";

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("NOT_CONFIGURED: ELEVENLABS_API_KEY is not set");
  return key;
}

async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown; query?: Record<string, string> },
): Promise<T> {
  const qs = init?.query ? `?${new URLSearchParams(init.query)}` : "";
  const res = await fetch(`${BASE}${path}${qs}`, {
    method: init?.method ?? "GET",
    headers: { "xi-api-key": apiKey(), "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`ElevenLabs Agents ${res.status} on ${path}: ${text.slice(0, 600)}`);
    let detail = text.slice(0, 300);
    let code = "";
    try {
      const parsed = JSON.parse(text) as {
        detail?: { message?: string; status?: string } | string | { msg?: string }[];
      };
      if (typeof parsed.detail === "string") detail = parsed.detail;
      else if (Array.isArray(parsed.detail)) {
        detail = parsed.detail.map((d) => d.msg).filter(Boolean).join("; ") || detail;
      } else if (parsed.detail) {
        if (parsed.detail.message) detail = parsed.detail.message;
        if (parsed.detail.status) code = parsed.detail.status;
      }
    } catch {
      // Keep the raw body.
    }
    throw new Error(`ElevenLabs ${res.status}${code ? ` [${code}]` : ""}: ${detail}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// ── Agents ───────────────────────────────────────────────────────────────

export type AgentSpec = {
  name: string;
  /** System prompt. */
  prompt: string;
  /** Spoken first; carries the AI + recording disclosure. */
  firstMessage: string;
  /** ElevenLabs voice id (already resolved from our pooled key). */
  voiceId: string;
  maxDurationSec: number;
  /** Let each outbound call override prompt + first message (qualifier). */
  allowCallOverrides?: boolean;
};

function agentBody(spec: AgentSpec) {
  return {
    name: spec.name.slice(0, 100),
    conversation_config: {
      agent: {
        first_message: spec.firstMessage,
        language: "en",
        prompt: {
          prompt: spec.prompt,
          // Let the agent hang up when the conversation is over.
          built_in_tools: {
            end_call: {
              name: "end_call",
              description: "End the call when the conversation is finished or the person asks to stop.",
              params: { system_tool_type: "end_call" },
            },
          },
        },
      },
      tts: { voice_id: spec.voiceId },
      conversation: { max_duration_seconds: spec.maxDurationSec },
    },
    platform_settings: spec.allowCallOverrides
      ? {
          overrides: {
            conversation_config_override: {
              agent: { first_message: true, prompt: { prompt: true } },
            },
          },
        }
      : undefined,
  };
}

export async function createAgent(spec: AgentSpec): Promise<string> {
  const result = await call<{ agent_id?: string }>("/agents/create", {
    method: "POST",
    body: agentBody(spec),
  });
  if (!result.agent_id) throw new Error("ElevenLabs returned no agent id");
  return result.agent_id;
}

export async function updateAgent(agentId: string, spec: AgentSpec): Promise<void> {
  await call(`/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    body: agentBody(spec),
  });
}

export async function deleteAgent(agentId: string): Promise<void> {
  try {
    await call(`/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof Error && /^ElevenLabs 404/.test(error.message))) throw error;
  }
}

/** Update the agent when it still exists upstream, else create a new one. */
export async function upsertAgent(agentId: string | undefined, spec: AgentSpec): Promise<string> {
  if (agentId) {
    try {
      await updateAgent(agentId, spec);
      return agentId;
    } catch (error) {
      if (!(error instanceof Error && /^ElevenLabs 404/.test(error.message))) throw error;
    }
  }
  return await createAgent(spec);
}

/** Single-use WebRTC credential for a browser session with a private agent. */
export async function conversationToken(agentId: string): Promise<string> {
  const result = await call<{ token?: string }>("/conversation/token", {
    query: { agent_id: agentId },
  });
  if (!result.token) throw new Error("ElevenLabs returned no conversation token");
  return result.token;
}

// ── Conversations ────────────────────────────────────────────────────────

type RawConversation = {
  conversation_id: string;
  agent_id?: string;
  status?: "initiated" | "in-progress" | "processing" | "done" | "failed";
  transcript?: { role?: string; message?: string | null }[];
  metadata?: {
    call_duration_secs?: number;
    phone_call?: {
      direction?: "inbound" | "outbound";
      agent_number?: string;
      external_number?: string;
    } | null;
  };
  analysis?: {
    call_successful?: string;
    transcript_summary?: string;
  } | null;
};

export type ConversationDetails = {
  conversationId: string;
  agentId: string | null;
  /** Finished (done or failed) — safe to bill and close out. */
  finished: boolean;
  failed: boolean;
  durationSec: number;
  /** "user: …\nassistant: …" — same shape as Bland's concatenated transcript. */
  transcript: string;
  direction: "inbound" | "outbound" | null;
  agentNumber: string | null;
  externalNumber: string | null;
};

/** The source of truth for billing: never what a webhook body claims. */
export async function getConversation(conversationId: string): Promise<ConversationDetails> {
  const c = await call<RawConversation>(`/conversations/${encodeURIComponent(conversationId)}`);
  const transcript = (c.transcript ?? [])
    .filter((t) => t.message && t.message.trim())
    .map((t) => `${t.role === "agent" ? "assistant" : "user"}: ${t.message!.trim()}`)
    .join("\n");
  const phone = c.metadata?.phone_call ?? null;
  return {
    conversationId: c.conversation_id,
    agentId: c.agent_id ?? null,
    finished: c.status === "done" || c.status === "failed",
    failed: c.status === "failed",
    durationSec: Math.max(0, Math.round(Number(c.metadata?.call_duration_secs ?? 0) || 0)),
    transcript,
    direction: phone?.direction ?? null,
    agentNumber: phone?.agent_number ?? null,
    externalNumber: phone?.external_number ?? null,
  };
}

/** Recent conversations for one agent (newest first) — the sweep's input. */
export async function listConversations(
  agentId: string,
  sinceUnixSec: number,
): Promise<{ conversationId: string; status: string }[]> {
  const result = await call<{
    conversations?: { conversation_id: string; status: string }[];
  }>("/conversations", {
    query: {
      agent_id: agentId,
      page_size: "50",
      call_start_after_unix: String(Math.floor(sinceUnixSec)),
    },
  });
  return (result.conversations ?? []).map((c) => ({
    conversationId: c.conversation_id,
    status: c.status,
  }));
}

// ── Phone numbers + outbound ─────────────────────────────────────────────

/** Import a Twilio number we own so ElevenLabs can answer / dial on it. */
export async function importTwilioNumber(args: {
  phoneNumber: string;
  label: string;
  sid: string;
  token: string;
}): Promise<string> {
  const result = await call<{ phone_number_id?: string }>("/phone-numbers", {
    method: "POST",
    body: {
      provider: "twilio",
      phone_number: args.phoneNumber,
      label: args.label.slice(0, 100),
      sid: args.sid,
      token: args.token,
    },
  });
  if (!result.phone_number_id) throw new Error("ElevenLabs returned no phone number id");
  return result.phone_number_id;
}

/** Point an imported number at an agent (inbound calls go to it). */
export async function assignAgentToNumber(phoneNumberId: string, agentId: string): Promise<void> {
  await call(`/phone-numbers/${encodeURIComponent(phoneNumberId)}`, {
    method: "PATCH",
    body: { agent_id: agentId },
  });
}

export async function deletePhoneNumber(phoneNumberId: string): Promise<void> {
  try {
    await call(`/phone-numbers/${encodeURIComponent(phoneNumberId)}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof Error && /^ElevenLabs 404/.test(error.message))) throw error;
  }
}

/** Dial one lead. Per-call prompt/first message ride as overrides. */
export async function outboundCall(args: {
  agentId: string;
  phoneNumberId: string;
  toNumber: string;
  prompt: string;
  firstMessage: string;
}): Promise<string> {
  const result = await call<{
    success?: boolean;
    message?: string;
    conversation_id?: string | null;
  }>("/twilio/outbound-call", {
    method: "POST",
    body: {
      agent_id: args.agentId,
      agent_phone_number_id: args.phoneNumberId,
      to_number: args.toNumber,
      conversation_initiation_client_data: {
        conversation_config_override: {
          agent: { first_message: args.firstMessage, prompt: { prompt: args.prompt } },
        },
      },
    },
  });
  if (result.success === false || !result.conversation_id) {
    throw new Error(`ElevenLabs outbound call failed: ${result.message ?? "no conversation id"}`);
  }
  return result.conversation_id;
}

// ── Webhooks ─────────────────────────────────────────────────────────────

/** 30 minutes either way (the SDK's window) — stale or far-future signatures are refused. */
const SIGNATURE_TOLERANCE_SEC = 30 * 60;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * `ElevenLabs-Signature: t=<unix>,v0=<hex HMAC-SHA256(secret, "t.body")>`
 * (scheme per the official SDK's webhook verifier).
 */
export async function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  ) as Record<string, string | undefined>;
  const t = Number(parts.t);
  const v0 = parts.v0;
  if (!Number.isFinite(t) || !v0) return false;
  if (Math.abs(nowSec - t) > SIGNATURE_TOLERANCE_SEC) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, v0.toLowerCase());
}
