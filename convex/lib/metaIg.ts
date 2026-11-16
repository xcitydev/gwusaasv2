/**
 * Meta's own Instagram API ("API setup with Instagram login") — the direct
 * pipe that replaces GHL for IG DMs. Unlike GHL's Instagram channel it can
 * send audio, so voice notes arrive as playable audio.
 *
 * Accounts on this provider reuse the igAccounts / igConversations columns:
 *   igAccounts.ghlLocationId      = "meta:<IG professional account id>"
 *   igAccounts.locationToken      = sealed long-lived Instagram user token
 *   igConversations.ghlContactId  = the other person's IGSID
 *   igConversations.ghlConversationId = "meta:<account id>:<IGSID>"
 * so routing, dedupe and every existing query keep working unchanged.
 *
 * Env: META_IG_APP_ID, META_IG_APP_SECRET (Instagram app id/secret from the
 * Meta dashboard), META_IG_WEBHOOK_VERIFY_TOKEN (any random string, also
 * pasted into the dashboard's webhook "Verify token" field).
 */

const GRAPH = "https://graph.instagram.com";
const GRAPH_VERSION = "v27.0";
export const META_PREFIX = "meta:";
export const META_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
];

export function isMetaLocation(locationId: string): boolean {
  return locationId.startsWith(META_PREFIX);
}

export function metaLocationId(igAccountId: string): string {
  return `${META_PREFIX}${igAccountId}`;
}

export function metaConversationKey(igAccountId: string, igsid: string): string {
  return `${META_PREFIX}${igAccountId}:${igsid}`;
}

export function metaConfigured(): boolean {
  return Boolean(process.env.META_IG_APP_ID && process.env.META_IG_APP_SECRET);
}

function creds(): { id: string; secret: string } {
  const id = process.env.META_IG_APP_ID;
  const secret = process.env.META_IG_APP_SECRET;
  if (!id || !secret) throw new Error("NOT_CONFIGURED: Instagram direct connect keys are not set");
  return { id, secret };
}

export function metaRedirectUri(): string {
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new Error("CONVEX_SITE_URL missing");
  return `${site}/meta/ig/oauth/callback`;
}

export function metaAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: creds().id,
    redirect_uri: metaRedirectUri(),
    response_type: "code",
    scope: META_SCOPES.join(","),
    state,
    // Instagram credentials only; the Facebook option confuses clients.
    enable_fb_login: "false",
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`Instagram ${what} ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Instagram ${what}: unexpected response ${text.slice(0, 200)}`);
  }
}

/** code → long-lived (60-day) token + the professional account id/username. */
export async function exchangeMetaCode(code: string): Promise<{
  accessToken: string;
  expiresIn: number;
  igAccountId: string;
  username: string | null;
}> {
  const { id, secret } = creds();
  // Meta appends "#_" to the code on redirect.
  const cleanCode = code.replace(/#_$/, "");
  const short = await readJson<{
    access_token?: string;
    data?: { access_token: string }[];
  }>(
    await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        grant_type: "authorization_code",
        redirect_uri: metaRedirectUri(),
        code: cleanCode,
      }).toString(),
    }),
    "token exchange",
  );
  const shortToken = short.access_token ?? short.data?.[0]?.access_token;
  if (!shortToken) throw new Error("Instagram token exchange returned no token");
  const long = await readJson<{ access_token: string; expires_in: number }>(
    await fetch(
      `${GRAPH}/access_token?${new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: secret,
        access_token: shortToken,
      })}`,
    ),
    "long-lived token",
  );
  // user_id here is the professional account id — the one webhooks use as
  // entry.id (the token response's user_id is app-scoped instead).
  const me = await readJson<{ user_id?: string | number; id?: string; username?: string }>(
    await fetch(`${GRAPH}/${GRAPH_VERSION}/me?fields=user_id,username`, {
      headers: { Authorization: `Bearer ${long.access_token}` },
    }),
    "profile",
  );
  const igAccountId = String(me.user_id ?? me.id ?? "");
  if (!igAccountId) throw new Error("Instagram returned no account id");
  return {
    accessToken: long.access_token,
    expiresIn: long.expires_in,
    igAccountId,
    username: me.username ?? null,
  };
}

/** Extend a long-lived token another 60 days (must be ≥24 h old). */
export async function refreshMetaToken(
  token: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await readJson<{ access_token: string; expires_in: number }>(
    await fetch(
      `${GRAPH}/refresh_access_token?${new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: token,
      })}`,
    ),
    "token refresh",
  );
  return { accessToken: res.access_token, expiresIn: res.expires_in };
}

/** Turn on DM webhooks for this account (app-level subscription is in the dashboard). */
export async function subscribeMetaWebhooks(token: string): Promise<void> {
  await readJson<{ success?: boolean }>(
    await fetch(
      `${GRAPH}/${GRAPH_VERSION}/me/subscribed_apps?subscribed_fields=messages`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    ),
    "webhook subscription",
  );
}

/** Send text, or audio by public URL (aac/m4a/wav/mp4, ≤25 MB). */
export async function sendMetaMessage(args: {
  token: string;
  recipientId: string;
  text?: string;
  audioUrl?: string;
  /** Typed by a person: may use Meta's 7-day Human Agent window. */
  humanAgent?: boolean;
}): Promise<{ messageId?: string }> {
  const message = args.audioUrl
    ? { attachment: { type: "audio", payload: { url: args.audioUrl } } }
    : { text: args.text ?? "" };
  const post = (tagged: boolean) =>
    fetch(`${GRAPH}/${GRAPH_VERSION}/me/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: args.recipientId },
        message,
        ...(tagged && { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }),
      }),
    });
  let res = await post(false);
  let text = await res.text();
  // Past the standard 24 h window: a person's reply may go out tagged.
  if (!res.ok && args.humanAgent && isOutsideWindow(text)) {
    res = await post(true);
    text = await res.text();
  }
  if (!res.ok) {
    if (isOutsideWindow(text)) {
      throw new Error(
        args.humanAgent
          ? "Instagram only allows replies within 7 days of this person's last message. It will go through once they message again."
          : "Instagram only allows automatic replies within 24 hours of this person's last message.",
      );
    }
    throw new Error(`Instagram send ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = JSON.parse(text) as { message_id?: string };
  return { messageId: body.message_id };
}

/** Meta's "outside the allowed messaging window" refusal. */
function isOutsideWindow(errorBody: string): boolean {
  return /2534022|outside (of )?(the )?allowed window|messaging window/i.test(errorBody);
}

export type MetaConversation = {
  id: string;
  updated_time?: string;
  participants?: { data?: { id: string; username?: string }[] };
};

/** One page of the account's DM threads, newest first. */
export async function listMetaConversations(
  token: string,
  after?: string,
): Promise<{ conversations: MetaConversation[]; next?: string }> {
  const params = new URLSearchParams({
    platform: "instagram",
    fields: "id,updated_time,participants",
    limit: "25",
  });
  if (after) params.set("after", after);
  const res = await readJson<{
    data?: MetaConversation[];
    paging?: { cursors?: { after?: string }; next?: string };
  }>(
    await fetch(`${GRAPH}/${GRAPH_VERSION}/me/conversations?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    "conversations",
  );
  return {
    conversations: res.data ?? [],
    next: res.paging?.next ? res.paging.cursors?.after : undefined,
  };
}

export type MetaMessage = {
  id: string;
  created_time?: string;
  from?: { id: string; username?: string };
  message?: string;
  attachments?: { data?: unknown[] };
};

/** A thread's messages, newest first (Meta only serves the latest 20). */
export async function getMetaConversationMessages(
  token: string,
  conversationId: string,
): Promise<MetaMessage[]> {
  const res = await readJson<{ messages?: { data?: MetaMessage[] } }>(
    await fetch(
      `${GRAPH}/${GRAPH_VERSION}/${conversationId}?fields=${encodeURIComponent(
        "messages{id,created_time,from,message,attachments}",
      )}`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
    "messages",
  );
  return res.messages?.data ?? [];
}

/** Display name for an IGSID (name, else @username). */
export async function getMetaProfileName(
  token: string,
  igsid: string,
): Promise<string | null> {
  const res = await readJson<{ name?: string; username?: string }>(
    await fetch(`${GRAPH}/${GRAPH_VERSION}/${igsid}?fields=name,username`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    "profile lookup",
  );
  return res.name || (res.username ? `@${res.username}` : null);
}

/** Webhook X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, secret). */
export async function verifyMetaSignature(
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const given = header.slice("sha256=".length).toLowerCase();
  // Meta's docs say "App Secret"; for Instagram-login apps that is the
  // Instagram app secret, but accept the main app secret too if set.
  const secrets = [process.env.META_IG_APP_SECRET, process.env.META_APP_SECRET].filter(
    (s): s is string => Boolean(s),
  );
  const enc = new TextEncoder();
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
    const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
    if (hex.length === given.length) {
      let diff = 0;
      for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
      if (diff === 0) return true;
    }
  }
  return false;
}
