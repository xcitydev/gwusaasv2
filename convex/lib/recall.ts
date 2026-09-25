import type { RecallTranscriptEntry } from "./transcript";

/**
 * Recall.ai adapter — the meeting-bot pipe for the AI Note Taker. One API
 * call sends a bot into Zoom / Meet / Teams; Recall records, transcribes
 * and hands back speaker-labelled words. Every call is a no-op guard until
 * RECALL_API_KEY is set. Keys are REGION-SPECIFIC: set RECALL_REGION to the
 * region the key was created in (us-west-2 default; us-east-1,
 * eu-central-1, ap-northeast-1). Docs: https://docs.recall.ai
 */

const DEFAULT_REGION = "us-west-2";

export function recallConfigured(): boolean {
  return Boolean(process.env.RECALL_API_KEY);
}

function apiBase(): string {
  return `https://${process.env.RECALL_REGION || DEFAULT_REGION}.recall.ai`;
}

export class RecallError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; absoluteUrl?: boolean } = {},
): Promise<T> {
  const key = process.env.RECALL_API_KEY;
  if (!key) throw new Error("NOT_CONFIGURED: RECALL_API_KEY is not set");
  const res = await fetch(opts.absoluteUrl ? path : `${apiBase()}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Token ${key}`,
      Accept: "application/json",
      ...(opts.body !== undefined && { "Content-Type": "application/json" }),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new RecallError(
      res.status,
      `Recall ${res.status} ${path.split("?")[0]}: ${text.slice(0, 300)}`,
    );
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Recall non-JSON response from ${path}: ${text.slice(0, 200)}`);
  }
}

// ── Bots ────────────────────────────────────────────────────────────────

type MediaShortcut = {
  status?: { code?: string | null } | null;
  data?: { download_url?: string | null; title?: string | null } | null;
};

export type RecallRecording = {
  id: string;
  started_at?: string | null;
  completed_at?: string | null;
  media_shortcuts?: {
    transcript?: MediaShortcut | null;
    video_mixed?: MediaShortcut | null;
    meeting_metadata?: MediaShortcut | null;
  } | null;
};

export type RecallBot = {
  id: string;
  join_at?: string | null;
  status_changes?: {
    code: string;
    sub_code?: string | null;
    message?: string | null;
    created_at?: string | null;
  }[];
  recordings?: RecallRecording[];
  metadata?: Record<string, string>;
};

/**
 * Everything about HOW the bot behaves, minus where/when it joins — shared
 * by direct bots and calendar-event bots (Recall fills in URL + time there).
 */
export function botBehavior(opts: {
  botName: string;
  metadata: Record<string, string>;
  /** Recording disclosure posted in the meeting chat; null = stay silent. */
  announce: string | null;
  retentionHours: number;
  /** Hard cap on recording length — bounds per-meeting cost. */
  maxRecordingSec: number;
}): Record<string, unknown> {
  return {
    bot_name: opts.botName.slice(0, 100),
    metadata: opts.metadata,
    recording_config: {
      transcript: {
        provider: {
          // Accuracy mode: transcript lands a few minutes after the call,
          // any language, with Recall's own engine ($0.15/h).
          recallai_streaming: {
            mode: "prioritize_accuracy",
            language_code: "auto",
          },
        },
        diarization: { use_separate_streams_when_available: true },
      },
      retention: { type: "timed", hours: Math.max(1, opts.retentionHours) },
    },
    // Leave on our terms, not Recall's hour-long defaults: nobody shows,
    // everyone left, a dead-silent room, or the credit-bounded max length.
    automatic_leave: {
      waiting_room_timeout: 900,
      noone_joined_timeout: 900,
      everyone_left_timeout: { timeout: 30 },
      silence_detection: { timeout: 900, activate_after: 600 },
      in_call_recording_timeout: Math.max(60, Math.floor(opts.maxRecordingSec)),
    },
    ...(opts.announce && {
      chat: { on_bot_join: { send_to: "everyone", message: opts.announce } },
    }),
  };
}

export async function createBot(args: {
  meetingUrl: string;
  /** Epoch ms. >10 min ahead = a guaranteed scheduled bot; else ad-hoc. */
  joinAt?: number;
  behavior: Record<string, unknown>;
}): Promise<RecallBot> {
  return await request<RecallBot>("/api/v1/bot/", {
    method: "POST",
    body: {
      meeting_url: args.meetingUrl,
      ...(args.joinAt && { join_at: new Date(args.joinAt).toISOString() }),
      ...args.behavior,
    },
  });
}

export async function getBot(botId: string): Promise<RecallBot> {
  return await request<RecallBot>(`/api/v1/bot/${encodeURIComponent(botId)}/`);
}

/** Pull a bot out of a call it is joining or already in. */
export async function leaveCall(botId: string): Promise<void> {
  await request(`/api/v1/bot/${encodeURIComponent(botId)}/leave_call/`, {
    method: "POST",
  });
}

/** Cancel a scheduled bot (only valid >10 min before join_at). */
export async function deleteScheduledBot(botId: string): Promise<void> {
  await request(`/api/v1/bot/${encodeURIComponent(botId)}/`, {
    method: "DELETE",
  });
}

/** Permanently delete the recording + transcript Recall holds for a bot. */
export async function deleteBotMedia(botId: string): Promise<void> {
  await request(`/api/v1/bot/${encodeURIComponent(botId)}/delete_media/`, {
    method: "POST",
  });
}

/** The transcript artifact is a pre-signed URL — no auth header. */
export async function downloadTranscript(
  downloadUrl: string,
): Promise<RecallTranscriptEntry[]> {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Recall transcript download ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as RecallTranscriptEntry[]) : [];
}

// ── Webhook verification (Svix-style) ───────────────────────────────────

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * HMAC-SHA256 over `${id}.${timestamp}.${rawBody}` with the base64 half of
 * the whsec_ secret; the header carries space-separated "v1,<sig>" values
 * (several during secret rotation). Newer accounts send webhook-* headers,
 * older ones svix-* — the caller passes whichever it found.
 */
export async function verifyRecallSignature(args: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  rawBody: string;
  toleranceSec?: number;
}): Promise<boolean> {
  const { id, timestamp, signatureHeader } = args;
  if (!id || !timestamp || !signatureHeader) return false;
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;
  if (Math.abs(Date.now() / 1000 - sentAt) > (args.toleranceSec ?? 300)) {
    return false;
  }
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(args.secret.replace(/^whsec_/, ""));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${args.rawBody}`),
  );
  const expected = bytesToBase64(new Uint8Array(mac));
  return signatureHeader.split(" ").some((part) => {
    const [version, signature] = part.split(",");
    return version === "v1" && Boolean(signature) && constantTimeEqual(signature, expected);
  });
}

// ── Calendar V2 ─────────────────────────────────────────────────────────

export type CalendarPlatform = "google_calendar" | "microsoft_outlook";

export type RecallCalendar = {
  id: string;
  platform?: string;
  platform_email?: string | null;
  status?: string | null;
};

export type RecallCalendarEvent = {
  id: string;
  calendar_id?: string;
  start_time: string;
  end_time?: string | null;
  meeting_url?: string | null;
  meeting_platform?: string | null;
  is_deleted?: boolean;
  raw?: Record<string, unknown> | null;
  bots?: {
    bot_id: string;
    deduplication_key?: string | null;
    start_time?: string | null;
    meeting_url?: string | null;
  }[];
};

/** Hand Recall the user's refresh token; it syncs events from then on. */
export async function createCalendar(args: {
  platform: CalendarPlatform;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRefreshToken: string;
}): Promise<RecallCalendar> {
  return await request<RecallCalendar>("/api/v2/calendars/", {
    method: "POST",
    body: {
      platform: args.platform,
      oauth_client_id: args.oauthClientId,
      oauth_client_secret: args.oauthClientSecret,
      oauth_refresh_token: args.oauthRefreshToken,
    },
  });
}

export async function getCalendar(calendarId: string): Promise<RecallCalendar> {
  return await request<RecallCalendar>(
    `/api/v2/calendars/${encodeURIComponent(calendarId)}/`,
  );
}

export async function deleteCalendar(calendarId: string): Promise<void> {
  await request(`/api/v2/calendars/${encodeURIComponent(calendarId)}/`, {
    method: "DELETE",
  });
}

/** Events for one calendar; follows DRF `next` links (bounded). */
export async function listCalendarEvents(args: {
  calendarId: string;
  /** ISO — only events changed since (calendar.sync_events cursor). */
  updatedSince?: string;
  /** ISO — only events starting at/after. */
  startsAfter?: string;
  maxPages?: number;
}): Promise<RecallCalendarEvent[]> {
  const params = new URLSearchParams({ calendar_id: args.calendarId });
  if (args.updatedSince) params.set("updated_at__gte", args.updatedSince);
  if (args.startsAfter) params.set("start_time__gte", args.startsAfter);
  const events: RecallCalendarEvent[] = [];
  let url: string | null = `${apiBase()}/api/v2/calendar-events/?${params}`;
  for (let page = 0; url && page < (args.maxPages ?? 5); page++) {
    const result: { next?: string | null; results?: RecallCalendarEvent[] } =
      await request(url, { absoluteUrl: true });
    events.push(...(result.results ?? []));
    url = result.next ?? null;
  }
  return events;
}

export async function getCalendarEvent(
  eventId: string,
): Promise<RecallCalendarEvent> {
  return await request<RecallCalendarEvent>(
    `/api/v2/calendar-events/${encodeURIComponent(eventId)}/`,
  );
}

/** Schedule (or, with the same dedup key, reuse) the bot for an event. */
export async function scheduleEventBot(args: {
  eventId: string;
  deduplicationKey: string;
  behavior: Record<string, unknown>;
}): Promise<RecallCalendarEvent> {
  return await request<RecallCalendarEvent>(
    `/api/v2/calendar-events/${encodeURIComponent(args.eventId)}/bot/`,
    {
      method: "POST",
      body: {
        deduplication_key: args.deduplicationKey,
        bot_config: args.behavior,
      },
    },
  );
}

export async function removeEventBot(eventId: string): Promise<void> {
  await request(
    `/api/v2/calendar-events/${encodeURIComponent(eventId)}/bot/`,
    { method: "DELETE" },
  );
}

/** Title + invitees out of the provider's raw event (Google / Microsoft). */
export function describeEvent(event: RecallCalendarEvent): {
  title: string | null;
  attendees: { name: string; email?: string }[];
} {
  const raw = (event.raw ?? {}) as Record<string, unknown>;
  const title =
    (typeof raw.summary === "string" && raw.summary) ||
    (typeof raw.subject === "string" && raw.subject) ||
    null;
  const attendees: { name: string; email?: string }[] = [];
  const list = Array.isArray(raw.attendees) ? raw.attendees : [];
  for (const item of list as Record<string, unknown>[]) {
    // Google: {email, displayName}; Microsoft: {emailAddress:{name,address}}.
    const ms = item.emailAddress as { name?: string; address?: string } | undefined;
    const email =
      (typeof item.email === "string" && item.email) || ms?.address || undefined;
    const name =
      (typeof item.displayName === "string" && item.displayName) ||
      ms?.name ||
      email;
    if (name) attendees.push({ name, ...(email && { email }) });
  }
  return { title, attendees };
}
