/**
 * GoHighLevel v2 API — the pipe for IG DMs. Platform runs ONE agency
 * account; each customer workspace gets its own GHL location (sub-account).
 * OAuth via a private marketplace app (GHL_CLIENT_ID / GHL_CLIENT_SECRET).
 *
 * Every call is a no-op guard until the env keys are set; error bodies are
 * surfaced verbatim per the live-debug ritual. Shapes marked TO-VERIFY are
 * from GHL docs and get runtime-confirmed once keys land.
 */

const API_BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

/**
 * GHL locks locations.write to Agency-target apps and conversation scopes to
 * Sub-Account-target apps — so the integration is two private apps:
 * "provisioner" creates customer locations, "messenger" does the DMs.
 */
export type GhlApp = "provisioner" | "messenger";

function appCreds(app: GhlApp): { id: string; secret: string } {
  const id =
    app === "messenger"
      ? process.env.GHL_CLIENT_ID
      : process.env.GHL_PROVISIONER_CLIENT_ID;
  const secret =
    app === "messenger"
      ? process.env.GHL_CLIENT_SECRET
      : process.env.GHL_PROVISIONER_CLIENT_SECRET;
  if (!id || !secret) throw new Error(`GHL ${app} app keys not configured`);
  return { id, secret };
}

export function ghlConfigured(app: GhlApp = "messenger"): boolean {
  try {
    appCreds(app);
    return true;
  } catch {
    return false;
  }
}

const APP_SCOPES: Record<GhlApp, string> = {
  // oauth.write lives on the MESSENGER app (it's what mints location
  // tokens); the provisioner only creates sub-accounts.
  provisioner: ["locations.write", "locations.readonly"].join(" "),
  messenger: [
    "locations.readonly",
    "conversations.readonly",
    "conversations.write",
    "conversations/message.readonly",
    "conversations/message.write",
    "contacts.readonly",
    "contacts.write",
    "users.write",
    "oauth.write",
  ].join(" "),
};

export function installUrl(app: GhlApp, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: redirectUri,
    client_id: appCreds(app).id,
    scope: APP_SCOPES[app],
  });
  return `https://marketplace.gohighlevel.com/oauth/chooselocation?${params}`;
}

async function request<T>(
  path: string,
  opts: {
    method?: string;
    token: string;
    body?: unknown;
    form?: Record<string, string>;
  },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    Version: API_VERSION,
    Accept: "application/json",
  };
  let body: string | undefined;
  if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  // One retry on rate limits, server errors and dropped connections — the
  // deep sync issues hundreds of sequential calls and a single blip must
  // not abort a whole chunk.
  const attempt = () =>
    fetch(`${API_BASE}${path}`, { method: opts.method ?? "GET", headers, body });
  let res: Response;
  try {
    res = await attempt();
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    res = await attempt();
    void error;
  }
  if (res.status === 429 || res.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    res = await attempt();
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GHL ${res.status} ${path}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`GHL non-JSON response from ${path}: ${text.slice(0, 200)}`);
  }
}

export type GhlTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  companyId?: string;
  locationId?: string;
  userType?: string;
};

/** Exchange the OAuth code (agency install) or refresh an existing grant. */
export async function exchangeToken(args: {
  app: GhlApp;
  grant: "authorization_code" | "refresh_token";
  codeOrToken: string;
  redirectUri?: string;
}): Promise<GhlTokens> {
  const creds = appCreds(args.app);
  const baseForm: Record<string, string> = {
    client_id: creds.id,
    client_secret: creds.secret,
    grant_type: args.grant,
  };
  if (args.grant === "authorization_code") {
    baseForm.code = args.codeOrToken;
    if (args.redirectUri) baseForm.redirect_uri = args.redirectUri;
  } else {
    baseForm.refresh_token = args.codeOrToken;
  }
  const attempt = async (form: Record<string, string>) => {
    const res = await fetch(`${API_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  };
  // Some app types reject user_type — try with it, fall back without.
  let result = await attempt({ ...baseForm, user_type: "Company" });
  if (!result.ok) {
    const retry = await attempt(baseForm);
    if (retry.ok) result = retry;
  }
  if (!result.ok) {
    throw new Error(
      `GHL token ${result.status}: ${result.text.slice(0, 300)} (note: codes are single-use and expire in minutes — if this followed an earlier failed attempt, restart from a fresh install link)`,
    );
  }
  return JSON.parse(result.text) as GhlTokens;
}

/** Agency token → short-lived token scoped to one location. */
export async function mintLocationToken(args: {
  agencyToken: string;
  companyId: string;
  locationId: string;
}): Promise<{ access_token: string; expires_in: number }> {
  return await request<{ access_token: string; expires_in: number }>(
    "/oauth/locationToken",
    {
      method: "POST",
      token: args.agencyToken,
      form: { companyId: args.companyId, locationId: args.locationId },
    },
  );
}

/** Create the customer's sub-account. TO-VERIFY: required fields at runtime. */
export async function createLocation(args: {
  agencyToken: string;
  companyId: string;
  name: string;
}): Promise<string> {
  const result = await request<{ id?: string; location?: { id?: string } }>(
    "/locations/",
    {
      method: "POST",
      token: args.agencyToken,
      body: { companyId: args.companyId, name: args.name },
    },
  );
  const id = result.id ?? result.location?.id;
  if (!id) throw new Error("GHL returned no location id");
  return id;
}

/**
 * Send an IG DM into an existing conversation's contact. Attachments are
 * public URLs (GHL fetches them; WAV/MP3 accepted, max 5) — a voice note
 * is an attachment-only message.
 */
export async function sendIgMessage(args: {
  locationToken: string;
  contactId: string;
  message?: string;
  attachments?: string[];
}): Promise<{ conversationId?: string; messageId?: string }> {
  return await request<{ conversationId?: string; messageId?: string }>(
    "/conversations/messages",
    {
      method: "POST",
      token: args.locationToken,
      body: {
        type: "IG",
        contactId: args.contactId,
        ...(args.message && { message: args.message }),
        ...(args.attachments?.length && { attachments: args.attachments }),
      },
    },
  );
}

/** All locations under the agency (verification + binding helper). */
export async function listLocations(args: {
  agencyToken: string;
  companyId: string;
}): Promise<{ id: string; name: string }[]> {
  const result = await request<{
    locations?: { _id?: string; id?: string; name?: string }[];
  }>(
    `/locations/search?companyId=${encodeURIComponent(args.companyId)}&limit=50`,
    { token: args.agencyToken },
  );
  return (result.locations ?? [])
    .map((l) => ({ id: l.id ?? l._id ?? "", name: l.name ?? "" }))
    .filter((l) => l.id);
}

/**
 * IG conversations for a location, newest first. Page by passing the last
 * row's lastMessageDate as startAfterDate (GHL: "the sort value of the
 * last document").
 */
export async function searchConversations(args: {
  locationToken: string;
  locationId: string;
  limit?: number;
  startAfterDate?: number;
}): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    locationId: args.locationId,
    limit: String(args.limit ?? 30),
    sortBy: "last_message_date",
    sort: "desc",
    lastMessageType: "TYPE_INSTAGRAM",
  });
  if (args.startAfterDate) {
    params.set("startAfterDate", String(args.startAfterDate));
  }
  const result = await request<{ conversations?: Record<string, unknown>[] }>(
    `/conversations/search?${params}`,
    { token: args.locationToken },
  );
  return result.conversations ?? [];
}

/** Messages in one conversation, newest batch. */
export async function getConversationMessages(args: {
  locationToken: string;
  conversationId: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const result = await request<{
    messages?: { messages?: Record<string, unknown>[] } | Record<string, unknown>[];
  }>(
    `/conversations/${encodeURIComponent(args.conversationId)}/messages?limit=${args.limit ?? 30}`,
    { token: args.locationToken },
  );
  const box = result.messages;
  if (Array.isArray(box)) return box;
  return box?.messages ?? [];
}

// ── In-app Instagram connect (social-media-posting OAuth) ───────────────

/**
 * Kick off GHL's Meta OAuth for a location. Server-side fetch with the
 * bearer; the Meta URL comes back as a redirect we hand to the browser.
 */
export async function startSocialOauth(args: {
  locationToken: string;
  locationId: string;
  userId: string;
  platform: "instagram" | "facebook";
}): Promise<{ status: number; redirectUrl: string | null; body: string }> {
  const params = new URLSearchParams({
    locationId: args.locationId,
    userId: args.userId,
  });
  const res = await fetch(
    `${API_BASE}/social-media-posting/oauth/${args.platform}/start?${params}`,
    {
      headers: {
        Authorization: `Bearer ${args.locationToken}`,
        Version: API_VERSION,
        Accept: "application/json",
      },
      redirect: "manual",
    },
  );
  const body = (await res.text()).slice(0, 400);
  return {
    status: res.status,
    redirectUrl: res.headers.get("location"),
    body,
  };
}

export type IgProfessionalAccount = {
  originId?: string;
  id?: string;
  name?: string;
  avatar?: string;
  pageId?: string;
};

/** IG professional accounts available after the OAuth popup completes. */
export async function listIgAccountsAfterOauth(args: {
  locationToken: string;
  locationId: string;
  accountId: string;
}): Promise<IgProfessionalAccount[]> {
  const result = await request<{
    results?: { accounts?: IgProfessionalAccount[] };
  }>(
    `/social-media-posting/oauth/${encodeURIComponent(args.locationId)}/instagram/accounts/${encodeURIComponent(args.accountId)}`,
    { token: args.locationToken },
  );
  return result.results?.accounts ?? [];
}

/** Attach one IG professional account to the location. */
export async function attachIgAccount(args: {
  locationToken: string;
  locationId: string;
  accountId: string;
  account: IgProfessionalAccount;
}): Promise<void> {
  await request(
    `/social-media-posting/oauth/${encodeURIComponent(args.locationId)}/instagram/accounts/${encodeURIComponent(args.accountId)}`,
    {
      method: "POST",
      token: args.locationToken,
      body: {
        originId: args.account.originId ?? args.account.id,
        name: args.account.name,
        avatar: args.account.avatar,
        pageId: args.account.pageId,
      },
    },
  );
}

/** Minimal hidden user on a location (OAuth start demands a userId). */
export async function createLocationUser(args: {
  token: string;
  companyId: string;
  locationId: string;
  email: string;
}): Promise<string> {
  const result = await request<{ id?: string; user?: { id?: string } }>(
    "/users/",
    {
      method: "POST",
      token: args.token,
      body: {
        companyId: args.companyId,
        firstName: "GWU",
        lastName: "Connector",
        email: args.email,
        password: `Gwu!${Math.random().toString(36).slice(2, 10)}A1`,
        type: "account",
        role: "admin",
        locationIds: [args.locationId],
      },
    },
  );
  const id = result.id ?? result.user?.id;
  if (!id) throw new Error("GHL returned no user id");
  return id;
}

/** Contact lookup for names on inbound DMs. */
export async function getContact(args: {
  locationToken: string;
  contactId: string;
}): Promise<{ name: string | null }> {
  const result = await request<{
    contact?: { firstName?: string; lastName?: string; name?: string };
  }>(`/contacts/${encodeURIComponent(args.contactId)}`, {
    token: args.locationToken,
  });
  const c = result.contact;
  const name =
    c?.name ?? [c?.firstName, c?.lastName].filter(Boolean).join(" ").trim();
  return { name: name || null };
}
