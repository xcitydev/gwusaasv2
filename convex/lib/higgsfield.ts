/**
 * Higgsfield Cloud API adapter — the second generation provider behind
 * Create with AI's Studio tab. fal-style queue: submit → request_id +
 * status_url → poll. Auth is a KEY-ID:SECRET pair. Failed / nsfw requests
 * are never charged upstream; canceled queued ones are refunded. Outputs
 * live ≥ 7 days on their CDN, so results get copied into our storage.
 * Every call is a no-op guard until HIGGSFIELD_KEY_ID/SECRET are set.
 * Docs: https://docs.higgsfield.ai
 */

const BASE = "https://api.higgsfield.ai";

export function higgsfieldConfigured(): boolean {
  return Boolean(
    process.env.HIGGSFIELD_KEY_ID && process.env.HIGGSFIELD_KEY_SECRET,
  );
}

function authHeader(): string {
  const id = process.env.HIGGSFIELD_KEY_ID;
  const secret = process.env.HIGGSFIELD_KEY_SECRET;
  if (!id || !secret) {
    throw new Error("NOT_CONFIGURED: HIGGSFIELD_KEY_ID / HIGGSFIELD_KEY_SECRET not set");
  }
  return `Key ${id}:${secret}`;
}

export class HiggsfieldError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Their per-account concurrency cap — retry later, don't fail. */
    public busy = false,
  ) {
    super(message);
  }
}

async function request<T>(
  url: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      ...(opts.body !== undefined && { "Content-Type": "application/json" }),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const detail = errorDetail(text);
    // 429 = too many Soul IDs training at once; both mean "retry later".
    const busy = (res.status === 400 && /concurrent requests/i.test(detail)) || res.status === 429;
    throw new HiggsfieldError(
      res.status,
      `Higgsfield ${res.status}: ${detail}`,
      busy,
    );
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Higgsfield non-JSON response: ${text.slice(0, 200)}`);
  }
}

/** Their errors come as {detail: "…"} or {detail: [{msg}]} or {message}. */
function errorDetail(text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      detail?: unknown;
      message?: string;
      error?: string;
    };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (Array.isArray(parsed.detail)) {
      return parsed.detail
        .map((d) => (typeof d === "object" && d && "msg" in d ? String(d.msg) : String(d)))
        .join("; ");
    }
    return parsed.message ?? parsed.error ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

export type HfStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "nsfw"
  | "canceled";

export type HfSubmission = {
  requestId: string;
  statusUrl: string;
  cancelUrl: string | null;
};

/**
 * Queue a generation. `path` is the model route ("/higgsfield-ai/soul/v2/
 * standard"); `webhookUrl` (optional) gets a POST when it finishes — an
 * accelerator only, state is always re-read from status_url.
 */
export async function submit(
  path: string,
  body: Record<string, unknown>,
  webhookUrl?: string,
): Promise<HfSubmission> {
  const url = new URL(`${BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (webhookUrl) url.searchParams.set("hf_webhook", webhookUrl);
  const result = await request<{
    request_id?: string;
    status_url?: string;
    cancel_url?: string;
  }>(url.toString(), { method: "POST", body });
  if (!result.request_id) throw new Error("Higgsfield returned no request id");
  return {
    requestId: result.request_id,
    statusUrl: result.status_url ?? `${BASE}/requests/${result.request_id}/status`,
    cancelUrl: result.cancel_url ?? null,
  };
}

export type HfEstimate =
  | { kind: "estimate"; usd: number; credits: number }
  /** Token-metered models answer with a pricing formula instead of a number. */
  | { kind: "description"; text: string };

/**
 * What this request would cost the account — same body as the generation
 * call. Flat-priced models return {usd, credits} (authoritative per the
 * docs); token-metered video models return a description of the formula,
 * which the caller evaluates itself.
 */
export async function estimate(
  path: string,
  body: Record<string, unknown>,
): Promise<HfEstimate> {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const result = await request<{
    type?: string;
    usd?: string | number;
    credits?: string | number;
    pricing_description?: string;
  }>(`${BASE}/estimate${clean}`, { method: "POST", body });
  if (result.type === "description" || (result.usd === undefined && result.pricing_description)) {
    return { kind: "description", text: String(result.pricing_description ?? "") };
  }
  const usd = Number(result.usd);
  const credits = Number(result.credits);
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error("Higgsfield estimate returned no price");
  }
  return { kind: "estimate", usd, credits: Number.isFinite(credits) ? credits : 0 };
}

export type HfStatusResult = {
  status: HfStatus;
  /** First output URL (image, video or audio), once completed. */
  outputUrl: string | null;
  outputUrls: string[];
  error: string | null;
};

export async function getStatus(statusUrl: string): Promise<HfStatusResult> {
  const result = await request<{
    status?: string;
    images?: { url?: string }[];
    video?: { url?: string };
    videos?: { url?: string }[];
    audio?: { url?: string };
    audios?: { url?: string }[];
    error?: unknown;
    detail?: unknown;
  }>(statusUrl);
  const urls = [
    ...(result.images ?? []).map((i) => i.url),
    result.video?.url,
    ...(result.videos ?? []).map((v) => v.url),
    result.audio?.url,
    ...(result.audios ?? []).map((a) => a.url),
  ].filter((u): u is string => typeof u === "string" && u.length > 0);
  const raw = String(result.status ?? "queued").toLowerCase();
  const status: HfStatus = (
    ["queued", "in_progress", "completed", "failed", "nsfw", "canceled"] as const
  ).includes(raw as HfStatus)
    ? (raw as HfStatus)
    : "queued";
  const error =
    typeof result.error === "string"
      ? result.error
      : result.error && typeof result.error === "object" && "message" in result.error
        ? String((result.error as { message: unknown }).message)
        : typeof result.detail === "string"
          ? result.detail
          : null;
  return { status, outputUrl: urls[0] ?? null, outputUrls: urls, error };
}

/** Only works while still queued; a refund follows upstream. */
export async function cancel(cancelUrl: string): Promise<void> {
  await request(cancelUrl, { method: "POST" });
}

/** Human wording for the two upstream rejections. */
export function terminalFailureMessage(result: HfStatusResult): string {
  if (result.status === "nsfw") {
    return "Rejected by the model's content filter — the input or result was flagged.";
  }
  if (result.status === "canceled") return "The request was canceled.";
  // Tag upstream text with the engine so the public-error scrubber files it
  // under generation (e.g. their "credit balance is too low" is OUR account,
  // not the user's) instead of guessing a vendor from the wording.
  return result.error ? `Higgsfield: ${result.error.slice(0, 200)}` : "The model failed to generate";
}

export type MarketingPreset = {
  id: string;
  type?: string;
  name: string;
  cover_image?: string;
  metadata?: { aspect_ratio?: string; group_name?: string };
  format_slugs?: string[];
};

/** One page of Marketing Studio Image presets (style recipes for product shots/ads). */
export async function listMarketingPresets(opts: {
  search?: string;
  size?: number;
  cursor?: number;
}): Promise<{ total: number; cursor: number | null; items: MarketingPreset[] }> {
  const params = new URLSearchParams();
  if (opts.search) params.set("search", opts.search.slice(0, 100));
  params.set("size", String(Math.min(100, Math.max(1, opts.size ?? 100))));
  params.set("cursor", String(opts.cursor ?? 0));
  return await request(`${BASE}/marketing-studio/image/presets?${params}`);
}

export type SoulVersion = "v1" | "v2" | "cinema";

export type CustomReference = {
  id: string;
  name?: string;
  model_version?: SoulVersion;
  status: "not_ready" | "queued" | "in_progress" | "completed" | "failed" | string;
  thumbnail_url?: string | null;
  fail_reason?: string | null;
};

/**
 * Soul ID: train a reusable character from photos. Not a /requests job —
 * poll getCustomReference(id) until "completed", then pass the id as
 * custom_reference_id to the matching Soul model. A 429 means too many
 * are training at once (nothing charged); HiggsfieldError.busy covers it.
 */
export async function createCustomReference(args: {
  name: string;
  modelVersion: SoulVersion;
  imageUrls: string[];
}): Promise<CustomReference> {
  return await request(`${BASE}/v1/custom-references`, {
    method: "POST",
    body: {
      name: args.name.slice(0, 100),
      model_version: args.modelVersion,
      input_images: args.imageUrls.map((image_url) => ({ type: "image_url", image_url })),
    },
  });
}

export async function getCustomReference(id: string): Promise<CustomReference> {
  return await request(`${BASE}/v1/custom-references/${encodeURIComponent(id)}`);
}
