/**
 * Explorium (Vibe Prospecting) B2B database adapter. Gated on
 * EXPLORIUM_API_KEY. Endpoint shapes follow their AgentSource API docs and
 * are marked for verification on the first live search — errors surface
 * verbatim, same pattern that debugged the Instantly integration.
 */

import type { FoundLead } from "./apify";

const BASE = "https://api.explorium.ai/v1";

export function exploriumConfigured(): boolean {
  return Boolean(process.env.EXPLORIUM_API_KEY);
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.EXPLORIUM_API_KEY;
  if (!key) throw new Error("NOT_CONFIGURED: EXPLORIUM_API_KEY is not set");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { api_key: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Explorium ${res.status} on ${path}: ${text.slice(0, 500)}`);
    let detail = "";
    try {
      const parsed = JSON.parse(text) as {
        message?: string;
        details?: string;
        detail?: unknown;
      };
      detail = String(
        parsed.message ??
          parsed.details ??
          JSON.stringify(parsed.detail ?? "").slice(0, 200),
      );
    } catch {
      detail = text.slice(0, 200);
    }
    throw new Error(`Explorium ${res.status}: ${detail || "request failed"}`);
  }
  return (await res.json()) as T;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Search prospects by title/location/industry; returns mapped FoundLeads. */
export async function fetchProspects(args: {
  jobTitles: string[];
  country: string | null;
  region: string | null;
  city: string | null;
  industry: string | null;
  limit: number;
}): Promise<{ rows: FoundLead[]; warning: string | null }> {
  const filters: Record<string, unknown> = {};
  if (args.jobTitles.length > 0) {
    filters.job_title = { values: args.jobTitles };
  }
  if (args.country) {
    filters.country_code = { values: [countryToCode(args.country)] };
  }
  // Live-verified format requirement: 'City, CountryCode' or
  // 'City, RegionCode, CountryCode' (e.g. 'Miami, FL, US') — bare city 422s.
  if (args.city) {
    const countryCode = args.country
      ? countryToCode(args.country).toUpperCase()
      : args.region && toRegionCode(args.region)
        ? "US" // a US state code implies the country
        : null;
    if (countryCode) {
      const cityValue = [args.city, toRegionCode(args.region), countryCode]
        .filter(Boolean)
        .join(", ");
      filters.city_region_country = { values: [cityValue] };
    }
  }
  // Live-verified: industry filter is linkedin_category and its values must
  // come from LinkedIn's official taxonomy (developers.explorium.ai/categories)
  // — anything else 422s. Unknown industries are dropped, not guessed.
  const category = args.industry ? toLinkedinCategory(args.industry) : null;
  if (category) filters.linkedin_category = { values: [category] };

  // Their page size tops out around 100 — paginate for larger requests.
  const rows: Record<string, unknown>[] = [];
  const pageSize = Math.min(args.limit, 100);
  const maxPages = Math.ceil(args.limit / pageSize);
  for (let page = 1; page <= maxPages && rows.length < args.limit; page++) {
    const result = await call<{
      data?: Record<string, unknown>[];
      prospects?: Record<string, unknown>[];
    }>("/prospects", {
      mode: "full",
      size: args.limit,
      page_size: pageSize,
      page,
      filters,
    });
    const batch = result.data ?? result.prospects ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  const prospects = rows.slice(0, args.limit);

  // Step 2 (live-verified 2026-09-01): the search response has NO contact
  // info — emails/phones come from bulk contact enrichment, which is also
  // what consumes Explorium credits (one per enriched prospect).
  const { contacts, error: enrichError } = await bulkEnrichContacts(
    prospects.map((p) => str(p.prospect_id)).filter(Boolean),
  );

  const mapped = prospects.map((item) => {
    const first = str(item.first_name) || str(item.firstName);
    const last = str(item.last_name) || str(item.lastName);
    const contact = contacts.get(str(item.prospect_id));
    return {
      email: contact?.email ?? "",
      name: str(item.full_name) || `${first} ${last}`.trim(),
      company: str(item.company_name) || str(item.companyName),
      title: str(item.job_title) || str(item.jobTitle),
      location: [str(item.city), str(item.region_name) || str(item.region), str(item.country_name)]
        .filter(Boolean)
        .join(", "),
      industry: str(item.company_industry) || str(item.industry),
      website: str(item.company_website) || str(item.linkedin) || str(item.linkedin_url),
      phone: contact?.phone ?? "",
    };
  });
  return { rows: mapped, warning: enrichError };
}

type ContactInfo = { email: string; phone: string };

/**
 * POST /prospects/contacts_information/bulk_enrich — returns per-prospect
 * emails ([{address, type}]) with a validity status, and phone numbers.
 * Professional + valid addresses win; personal ones are the fallback.
 */
async function bulkEnrichContacts(
  prospectIds: string[],
): Promise<{ contacts: Map<string, ContactInfo>; error: string | null }> {
  const contacts = new Map<string, ContactInfo>();
  let error: string | null = null;
  const CHUNK = 100;
  for (let i = 0; i < prospectIds.length; i += CHUNK) {
    const chunk = prospectIds.slice(i, i + CHUNK);
    try {
      const result = await call<{
        data?: {
          prospect_id?: string;
          data?: {
            emails?: { address?: string; type?: string }[];
            professions_email?: string;
            professional_email_status?: string;
            phone_numbers?: { phone_number?: string }[];
            mobile_phone?: string;
          };
        }[];
      }>("/prospects/contacts_information/bulk_enrich", { prospect_ids: chunk });
      for (const entry of result.data ?? []) {
        const d = entry.data;
        if (!entry.prospect_id || !d) continue;
        const professional =
          d.professional_email_status === "valid" ? str(d.professions_email) : "";
        const byType = (type: string) =>
          str(d.emails?.find((e) => e.type === type && e.address)?.address);
        const email =
          professional || byType("current_professional") || str(d.emails?.[0]?.address);
        const phone = str(d.mobile_phone) || str(d.phone_numbers?.[0]?.phone_number);
        contacts.set(entry.prospect_id, { email, phone });
      }
    } catch (e) {
      // Partial enrichment (e.g. credits ran out mid-batch) still returns
      // the profiles — rows show up email-less and the warning says why.
      console.error("Explorium enrichment failed for a chunk:", e);
      error = e instanceof Error ? e.message.replace(/^Explorium \d+: /, "") : "enrichment failed";
    }
  }
  return { contacts, error };
}

const US_STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

/** Region → 2-letter code; null when it can't be expressed as one. */
function toRegionCode(region: string | null): string | null {
  if (!region) return null;
  const trimmed = region.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return US_STATE_CODES[trimmed.toLowerCase()] ?? null;
}

/** Free-form industry → LinkedIn taxonomy value; null = skip the filter. */
function toLinkedinCategory(industry: string): string | null {
  const needle = industry.toLowerCase();
  const map: [string, string][] = [
    ["software", "software development"],
    ["saas", "software development"],
    ["tech", "it services and it consulting"],
    ["real estate", "real estate"],
    ["realtor", "real estate agents and brokers"],
    ["marketing", "marketing services"],
    ["advertising", "advertising services"],
    ["dental", "dentists"],
    ["dentist", "dentists"],
    ["medical", "medical practices"],
    ["health", "hospitals and health care"],
    ["spa", "wellness and fitness services"],
    ["fitness", "wellness and fitness services"],
    ["gym", "wellness and fitness services"],
    ["restaurant", "restaurants"],
    ["legal", "law practice"],
    ["law", "law practice"],
    ["insurance", "insurance"],
    ["construction", "construction"],
    ["finance", "financial services"],
    ["banking", "banking"],
    ["e-commerce", "retail"],
    ["ecommerce", "retail"],
    ["retail", "retail"],
    ["staffing", "staffing and recruiting"],
    ["recruiting", "staffing and recruiting"],
  ];
  for (const [key, category] of map) {
    if (needle.includes(key)) return category;
  }
  return null;
}

function countryToCode(country: string): string {
  const map: Record<string, string> = {
    "united states": "us",
    usa: "us",
    canada: "ca",
    "united kingdom": "gb",
    uk: "gb",
    australia: "au",
    germany: "de",
    france: "fr",
  };
  return map[country.toLowerCase()] ?? country.toLowerCase().slice(0, 2);
}
