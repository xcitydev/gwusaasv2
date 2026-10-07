/**
 * Whop payments adapter. Whop is the money layer (checkout, subscriptions,
 * renewals, refunds, global payouts); Clerk stays identity-only and
 * workspace.plan in Convex stays the single source of truth for access.
 * The bridge is metadata: every checkout we create is stamped with our own
 * { workspaceId, userId, kind } so webhooks map deterministically back.
 *
 * Env: WHOP_API_KEY, WHOP_WEBHOOK_SECRET (ws_…), WHOP_PLAN_PERSONAL,
 * WHOP_PLAN_TEAM (plan_… ids), WHOP_COMPANY_ID (biz_… — needed for ad-hoc
 * one-time credit-pack plans), WHOP_SANDBOX=1 to hit the sandbox API.
 */

export function whopConfigured(): boolean {
  return Boolean(process.env.WHOP_API_KEY);
}

export function whopPlansConfigured(): boolean {
  return (
    whopConfigured() &&
    Boolean(process.env.WHOP_PLAN_PERSONAL && process.env.WHOP_PLAN_TEAM)
  );
}

export function whopTopupsConfigured(): boolean {
  return whopConfigured() && Boolean(process.env.WHOP_COMPANY_ID);
}

function apiBase(): string {
  return process.env.WHOP_SANDBOX === "1"
    ? "https://sandbox-api.whop.com"
    : "https://api.whop.com";
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.WHOP_API_KEY;
  if (!key) throw new Error("NOT_CONFIGURED: WHOP_API_KEY is not set");
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Whop ${res.status} ${path}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

type CheckoutResponse = { id: string; purchase_url: string };

/** The docs show purchase_url as a path — make it absolute either way. */
function absoluteUrl(url: string): string {
  return url.startsWith("/") ? `https://whop.com${url}` : url;
}

/** Checkout for a subscription plan that already exists on Whop. */
export async function createPlanCheckout(args: {
  planId: string;
  metadata: Record<string, string>;
  redirectUrl?: string;
}): Promise<{ id: string; url: string }> {
  const result = await request<CheckoutResponse>(
    "/api/v1/checkout_configurations",
    {
      mode: "payment",
      plan_id: args.planId,
      metadata: args.metadata,
      ...(args.redirectUrl && { redirect_url: args.redirectUrl }),
    },
  );
  return { id: result.id, url: absoluteUrl(result.purchase_url) };
}

/** One-time credit pack: an inline ad-hoc plan priced at checkout time. */
export async function createTopupCheckout(args: {
  usd: number;
  title: string;
  metadata: Record<string, string>;
  redirectUrl?: string;
}): Promise<{ id: string; url: string }> {
  const companyId = process.env.WHOP_COMPANY_ID;
  if (!companyId) throw new Error("NOT_CONFIGURED: WHOP_COMPANY_ID is not set");
  const result = await request<CheckoutResponse>(
    "/api/v1/checkout_configurations",
    {
      mode: "payment",
      plan: {
        company_id: companyId,
        currency: "usd",
        plan_type: "one_time",
        initial_price: Math.round(args.usd * 100) / 100,
        title: args.title,
        product: {
          external_identifier: "gwu-credit-packs",
          title: "Platform credits",
        },
      },
      metadata: args.metadata,
      ...(args.redirectUrl && { redirect_url: args.redirectUrl }),
    },
  );
  return { id: result.id, url: absoluteUrl(result.purchase_url) };
}

// ── Webhook signature (Svix wire format) ────────────────────────────────
// HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`, header "webhook-signature"
// carries space-separated "v1,<base64>" values. Whop's docs say the ws_…
// secret is used as received; classic Svix base64-decodes after the prefix —
// we accept either keying so a doc ambiguity can't break payments.

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

async function hmacBase64(keyBytes: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64(new Uint8Array(mac));
}

export async function verifyWhopSignature(args: {
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
  const message = `${id}.${timestamp}.${args.rawBody}`;
  const keys: Uint8Array[] = [new TextEncoder().encode(args.secret)];
  try {
    keys.push(base64ToBytes(args.secret.replace(/^ws_/, "")));
  } catch {
    // Secret isn't base64 after the prefix — raw keying alone then.
  }
  const expected = await Promise.all(keys.map((k) => hmacBase64(k, message)));
  return signatureHeader.split(" ").some((part) => {
    const [version, signature] = part.split(",");
    return (
      version === "v1" &&
      Boolean(signature) &&
      expected.some((e) => constantTimeEqual(signature, e))
    );
  });
}
