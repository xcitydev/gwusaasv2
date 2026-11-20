/**
 * Instantly.ai API v2 adapter — powers inbox warmup, campaign sending, the
 * master inbox, and analytics. Every call throws NOT_CONFIGURED until
 * INSTANTLY_API_KEY is set on the Convex deployment; callers treat that as
 * "keep local state only".
 *
 * Docs: https://developer.instantly.ai (v2, Bearer auth). v1 is deprecated.
 */

const BASE = "https://api.instantly.ai/api/v2";

export function instantlyConfigured(): boolean {
  return Boolean(process.env.INSTANTLY_API_KEY);
}

async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) throw new Error("NOT_CONFIGURED: INSTANTLY_API_KEY is not set");
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Instantly ${res.status} on ${path}: ${text}`);
    // Surface Instantly's own message — callers show it to the user.
    let detail = "";
    try {
      detail = String((JSON.parse(text) as { message?: string }).message ?? "");
    } catch {
      detail = text.slice(0, 200);
    }
    throw new Error(`Instantly ${res.status}: ${detail || "request failed"}`);
  }
  // DELETEs answer with an empty body.
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// ── Accounts (inboxes) ──────────────────────────────────────────────────

/** Register an IMAP/SMTP inbox with Instantly for sending + warmup. */
export async function createAccount(args: {
  email: string;
  firstName?: string;
  lastName?: string;
  imap: { host: string; port: string; username: string; password: string };
  smtp: { host: string; port: string; username: string; password: string };
  dailyLimit: number;
}): Promise<void> {
  await call("/accounts", {
    method: "POST",
    body: {
      email: args.email,
      first_name: args.firstName ?? args.email.split("@")[0],
      last_name: args.lastName ?? "",
      provider_code: providerCodeFor(args.smtp.host),
      imap_username: args.imap.username,
      imap_password: args.imap.password,
      imap_host: args.imap.host,
      imap_port: Number(args.imap.port),
      smtp_username: args.smtp.username,
      smtp_password: args.smtp.password,
      smtp_host: args.smtp.host,
      smtp_port: Number(args.smtp.port),
      daily_limit: args.dailyLimit,
    },
  });
}

/**
 * Instantly's provider codes: 1 custom IMAP/SMTP, 2 Google, 3 Microsoft.
 * The wrong code leaves the account unable to send.
 */
function providerCodeFor(smtpHost: string): 1 | 2 | 3 {
  const host = smtpHost.trim().toLowerCase();
  if (/(^|\.)(gmail|googlemail)\.com$/.test(host)) return 2;
  if (/(^|\.)(office365|outlook)\.com$/.test(host)) return 3;
  return 1;
}

// ── OAuth (Google Workspace / Microsoft) ────────────────────────────────

/** Start a provider sign-in; the user finishes it at authUrl. */
export async function initOAuth(
  provider: "google" | "microsoft",
): Promise<{ sessionId: string; authUrl: string; expiresAt: number }> {
  const result = await call<{ session_id: string; auth_url: string; expires_at: string }>(
    `/oauth/${provider}/init`,
    { method: "POST", body: {} },
  );
  return {
    sessionId: result.session_id,
    authUrl: result.auth_url,
    expiresAt: Date.parse(result.expires_at) || Date.now() + 10 * 60_000,
  };
}

export type OAuthStatus =
  | { status: "pending" }
  | { status: "success"; email: string; name?: string }
  | { status: "error"; error: string; description: string }
  | { status: "expired" };

/** Poll a sign-in. A success/error answer is only ever returned once. */
export async function getOAuthStatus(sessionId: string): Promise<OAuthStatus> {
  let result: Record<string, unknown>;
  try {
    result = await call(`/oauth/session/status/${encodeURIComponent(sessionId)}`);
  } catch (error) {
    if (error instanceof Error && /^Instantly 404/.test(error.message)) {
      return { status: "expired" };
    }
    throw error;
  }
  switch (result.status) {
    case "success":
      return {
        status: "success",
        email: String(result.email ?? "").toLowerCase(),
        name: typeof result.name === "string" ? result.name : undefined,
      };
    case "error":
      return {
        status: "error",
        error: String(result.error ?? "error"),
        description: String(result.error_description ?? ""),
      };
    case "expired":
      return { status: "expired" };
    default:
      return { status: "pending" };
  }
}

export async function enableWarmup(emails: string[]): Promise<void> {
  await call("/accounts/warmup/enable", { method: "POST", body: { emails } });
}

export async function pauseWarmup(emails: string[]): Promise<void> {
  // Live-verified: the v2 warmup-off route is /disable (returns an async
  // "update-warmup-accounts" job, same as /enable).
  await call("/accounts/warmup/disable", { method: "POST", body: { emails } });
}

export type WarmupAnalytics = {
  email: string;
  healthScore: number | null;
  sentTotal: number;
  landedInbox: number;
  sentLastDay: number;
};

/**
 * Warmup volume + health. Live-verified shape:
 * { email_date_data: {email: {date: {sent, landed_inbox}}},
 *   aggregate_data: {email: {sent, landed_inbox, health_score}} }
 */
export async function getWarmupAnalytics(
  emails: string[],
): Promise<WarmupAnalytics[]> {
  const result = await call<{
    email_date_data?: Record<string, Record<string, { sent?: number }>>;
    aggregate_data?: Record<
      string,
      { sent?: number; landed_inbox?: number; health_score?: number }
    >;
  }>("/accounts/warmup-analytics", { method: "POST", body: { emails } });
  return emails.map((email) => {
    const aggregate = result.aggregate_data?.[email];
    const byDate = result.email_date_data?.[email] ?? {};
    const lastDate = Object.keys(byDate).sort().at(-1);
    return {
      email,
      healthScore:
        typeof aggregate?.health_score === "number" ? aggregate.health_score : null,
      sentTotal: aggregate?.sent ?? 0,
      landedInbox: aggregate?.landed_inbox ?? 0,
      sentLastDay: lastDate ? (byDate[lastDate]?.sent ?? 0) : 0,
    };
  });
}

export type AccountState = {
  email: string;
  // Field-verified against the live API: 1 = warmup enabled.
  warmupActive: boolean;
  // stat_warmup_score: 0–100, builds as warmup runs.
  warmupScore: number | null;
};

/** Authoritative per-account state straight from Instantly. */
export async function listAccounts(): Promise<AccountState[]> {
  // Paginate: the sync treats an address missing from this list as gone from
  // the engine, so a truncated list would wrongly disconnect inboxes.
  const items: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const result = await call<{
      items?: Record<string, unknown>[];
      next_starting_after?: string | null;
    }>(
      `/accounts?limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ""}`,
    );
    items.push(...(result.items ?? []));
    cursor = result.next_starting_after ?? undefined;
    if (!cursor || (result.items ?? []).length === 0) break;
  }
  return items.map((item) => ({
    email: String(item.email ?? "").toLowerCase(),
    warmupActive: item.warmup_status === 1,
    warmupScore:
      typeof item.stat_warmup_score === "number" ? item.stat_warmup_score : null,
  }));
}

export async function deleteAccount(email: string): Promise<void> {
  await call(`/accounts/${encodeURIComponent(email)}`, { method: "DELETE" });
}

// ── Campaigns ───────────────────────────────────────────────────────────

export async function createCampaign(args: {
  name: string;
  timezone: string;
  windowStart: string; // "09:00"
  windowEnd: string; // "17:00"
  dailyLimit: number;
  emailList: string[];
  steps: { waitDays: number; subject: string; variants: string[] }[];
}): Promise<string> {
  const result = await call<{ id: string }>("/campaigns", {
    method: "POST",
    body: {
      name: args.name,
      campaign_schedule: {
        schedules: [
          {
            name: "Default",
            timing: { from: args.windowStart, to: args.windowEnd },
            // Monday–Friday; 0 = Sunday.
            days: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false },
            timezone: args.timezone,
          },
        ],
      },
      // Only the first array element is used by Instantly.
      sequences: [
        {
          steps: args.steps.map((step) => ({
            type: "email",
            delay: step.waitDays,
            variants: step.variants
              .filter((v) => v.trim())
              .map((body) => ({ subject: step.subject, body })),
          })),
        },
      ],
      email_list: args.emailList,
      daily_limit: args.dailyLimit,
      // List-Unsubscribe header (one-click unsubscribe in Gmail/Yahoo). The
      // visible footer with link + postal address is appended to every step
      // body by outreach.getCampaignForPublish (complianceFooter below).
      insert_unsubscribe_header: true,
    },
  });
  return result.id;
}

export async function addLeadsToCampaign(
  campaignId: string,
  leads: {
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    phone?: string;
    website?: string;
    title?: string;
    location?: string;
    industry?: string;
    name?: string;
  }[],
): Promise<void> {
  // v2 creates leads one at a time.
  for (const lead of leads) {
    const customVariables: Record<string, string> = {};
    if (lead.title) customVariables.title = lead.title;
    if (lead.location) customVariables.location = lead.location;
    if (lead.industry) customVariables.industry = lead.industry;
    if (lead.name) customVariables.name = lead.name;
    await call("/leads", {
      method: "POST",
      body: {
        campaign: campaignId,
        email: lead.email,
        first_name: lead.firstName,
        last_name: lead.lastName,
        company_name: lead.company,
        phone: lead.phone,
        website: lead.website,
        ...(Object.keys(customVariables).length > 0 && {
          custom_variables: customVariables,
        }),
      },
    });
  }
}

/** Mirror edits to an existing Instantly campaign (same payload as create). */
export async function updateCampaign(
  campaignId: string,
  args: {
    name: string;
    timezone: string;
    windowStart: string;
    windowEnd: string;
    dailyLimit: number;
    emailList: string[];
    steps: { waitDays: number; subject: string; variants: string[] }[];
  },
): Promise<void> {
  await call(`/campaigns/${campaignId}`, {
    method: "PATCH",
    body: {
      name: args.name,
      campaign_schedule: {
        schedules: [
          {
            name: "Default",
            timing: { from: args.windowStart, to: args.windowEnd },
            days: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false },
            timezone: args.timezone,
          },
        ],
      },
      sequences: [
        {
          steps: args.steps.map((step) => ({
            type: "email",
            delay: step.waitDays,
            variants: step.variants
              .filter((v) => v.trim())
              .map((body) => ({ subject: step.subject, body })),
          })),
        },
      ],
      email_list: args.emailList,
      daily_limit: args.dailyLimit,
      // List-Unsubscribe header (one-click unsubscribe in Gmail/Yahoo). The
      // visible footer with link + postal address is appended to every step
      // body by outreach.getCampaignForPublish (complianceFooter below).
      insert_unsubscribe_header: true,
    },
  });
}

export async function activateCampaign(campaignId: string): Promise<void> {
  await call(`/campaigns/${campaignId}/activate`, { method: "POST" });
}

/**
 * Remove a campaign from Instantly entirely. Its leads go with it, which is
 * what frees "uploaded contacts" on the account-level quota.
 */
export async function deleteCampaign(campaignId: string): Promise<void> {
  await call(`/campaigns/${encodeURIComponent(campaignId)}`, { method: "DELETE" });
}

export async function pauseCampaign(campaignId: string): Promise<void> {
  await call(`/campaigns/${campaignId}/pause`, { method: "POST" });
}

export async function getCampaignAnalytics(campaignId: string): Promise<{
  sent: number;
  opened: number;
  replied: number;
}> {
  const result = await call<Record<string, unknown>[] | Record<string, unknown>>(
    `/campaigns/analytics?id=${campaignId}`,
  );
  const row = (Array.isArray(result) ? result[0] : result) ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    sent: num(row.emails_sent_count ?? row.sent),
    opened: num(row.open_count ?? row.opened),
    replied: num(row.reply_count ?? row.replied),
  };
}

// ── Unibox (master inbox) ───────────────────────────────────────────────

export type InstantlyEmail = {
  id: string;
  subject: string;
  bodyText: string;
  fromEmail: string;
  fromName: string | null;
  campaignId: string | null;
  timestamp: number;
  eaccount: string | null;
};

/** Received reply emails, newest first. */
export async function listReplyEmails(limit = 100): Promise<InstantlyEmail[]> {
  const result = await call<{ items?: Record<string, unknown>[] }>(
    // email_type=received filters to replies landing in the unibox.
    `/emails?limit=${limit}&email_type=received`,
  );
  const items = result.items ?? [];
  return items.map((item) => {
    const body = item.body as Record<string, unknown> | undefined;
    return {
      id: String(item.id ?? ""),
      subject: String(item.subject ?? ""),
      bodyText: String(body?.text ?? body?.html ?? item.content_preview ?? ""),
      fromEmail: String(item.from_address_email ?? ""),
      fromName: extractFromName(item.from_address_json),
      campaignId: item.campaign_id ? String(item.campaign_id) : null,
      timestamp: item.timestamp_email
        ? new Date(String(item.timestamp_email)).getTime()
        : Date.now(),
      eaccount: item.eaccount ? String(item.eaccount) : null,
    };
  });
}

function extractFromName(raw: unknown): string | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first && typeof first === "object" && "name" in first) {
    const name = (first as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name;
  }
  return null;
}

/** Reply to a unibox thread from the inbox that received it. */
export async function replyToEmail(args: {
  replyToId: string;
  eaccount: string;
  subject: string;
  bodyText: string;
}): Promise<void> {
  await call("/emails/reply", {
    method: "POST",
    body: {
      reply_to_uuid: args.replyToId,
      eaccount: args.eaccount,
      subject: args.subject,
      body: { text: args.bodyText },
    },
  });
}

// ── Compliance footer ───────────────────────────────────────────────────

/**
 * CAN-SPAM footer appended to every campaign email: who is sending, their
 * postal address, and a working way to opt out. Instantly's v2 API has no
 * documented body unsubscribe variable, so the link goes to our public
 * /opt-out page (which suppresses the address platform-wide). Bodies are
 * HTML-ish text — Instantly wants <br/> for line breaks.
 */
export function complianceFooter(args: {
  postalAddress: string;
  optOutUrl: string;
}): string {
  const address = args.postalAddress
    .replace(/[<>]/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ");
  return (
    "<br/><br/>--<br/>" +
    `${address}<br/>` +
    `Don't want these emails? <a href="${args.optOutUrl}">Unsubscribe</a> or reply "unsubscribe".`
  );
}

// ── Block list ──────────────────────────────────────────────────────────

/**
 * Add an address to the workspace-wide Instantly block list so no campaign
 * on the shared account can email it again (unsubscribes + public opt-outs).
 * Docs: POST /block-lists-entries { bl_value } — not yet live-verified.
 */
export async function addToBlocklist(email: string): Promise<void> {
  await call("/block-lists-entries", { method: "POST", body: { bl_value: email } });
}
