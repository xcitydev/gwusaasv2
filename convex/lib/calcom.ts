/**
 * Cal.com v2 booking adapter — creates real calendar bookings from details
 * the AI receptionist collected on a call. Live-verified endpoint shape:
 * POST /v2/bookings with cal-api-version 2024-08-13; attendee email required.
 */

const BASE = "https://api.cal.com/v2";
const API_VERSION = "2024-08-13";

/**
 * Parse a public booking link like https://cal.com/jack/discovery-call into
 * {username, eventTypeSlug}. Org subdomains (acme.cal.com/jack/intro) carry
 * the org slug too.
 */
export function parseCalcomLink(
  link: string,
): { username: string; eventTypeSlug: string; organizationSlug?: string } | null {
  try {
    const url = new URL(link.includes("://") ? link : `https://${link}`);
    if (!/(^|\.)cal\.com$/.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const sub = url.hostname.replace(/\.?cal\.com$/, "");
    const organizationSlug =
      sub && sub !== "www" && sub !== "app" ? sub : undefined;
    return { username: parts[0], eventTypeSlug: parts[1], organizationSlug };
  } catch {
    return null;
  }
}

export async function createCalcomBooking(args: {
  // Either the public link identifiers (no auth needed)…
  username?: string;
  eventTypeSlug?: string;
  organizationSlug?: string;
  // …or the legacy key + event type id pair.
  apiKey?: string;
  eventTypeId?: number;
  startIsoUtc: string;
  name: string;
  email: string;
  phone?: string;
  timeZone: string;
  notes?: string;
}): Promise<{ uid: string | null }> {
  const res = await fetch(`${BASE}/bookings`, {
    method: "POST",
    headers: {
      ...(args.apiKey && { Authorization: `Bearer ${args.apiKey}` }),
      "Content-Type": "application/json",
      "cal-api-version": API_VERSION,
    },
    body: JSON.stringify({
      ...(args.eventTypeId
        ? { eventTypeId: args.eventTypeId }
        : {
            username: args.username,
            eventTypeSlug: args.eventTypeSlug,
            ...(args.organizationSlug && { organizationSlug: args.organizationSlug }),
          }),
      start: args.startIsoUtc,
      attendee: {
        name: args.name,
        email: args.email,
        timeZone: args.timeZone,
        ...(args.phone && { phoneNumber: args.phone }),
      },
      ...(args.notes && { metadata: { notes: args.notes.slice(0, 500) } }),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Cal.com ${res.status}: ${text.slice(0, 500)}`);
    let detail = "";
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string };
        message?: string;
      };
      detail = String(parsed.error?.message ?? parsed.message ?? "");
    } catch {
      detail = text.slice(0, 200);
    }
    throw new Error(`Cal.com ${res.status}: ${detail || "booking failed"}`);
  }
  const data = (await res.json()) as { data?: { uid?: string } };
  return { uid: data.data?.uid ?? null };
}
