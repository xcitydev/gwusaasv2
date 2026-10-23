/**
 * Leads are keyed by email per workspace. Phone-only leads (call lists, Maps
 * results without a scraped email) get a synthetic, never-mailable key built
 * from the phone digits — the same scheme the qualifier uses for leads added
 * by hand, so one number never becomes two leads.
 */
const PLACEHOLDER_DOMAIN = "@lead.manual";

export function phoneLeadKey(phone: string | undefined | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return `manual-${digits}${PLACEHOLDER_DOMAIN}`;
}

/** True for the synthetic key — never show it, export it or email it. */
export function isPlaceholderEmail(email: string | undefined | null): boolean {
  return Boolean(email && email.toLowerCase().endsWith(PLACEHOLDER_DOMAIN));
}

/** Shared-library leads older than this are ignored and the search re-scrapes. */
export const POOL_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
