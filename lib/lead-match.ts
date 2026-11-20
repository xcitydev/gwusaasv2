/**
 * Does a saved library lead actually match what a search asked for?
 *
 * The shared lead library answers searches from earlier scrapes. Its keyword
 * fallback uses Convex full-text search, which returns rows matching ANY
 * query word — so "restaurants in Miami" also pulled every saved Miami
 * barber (they match "miami"). Every fallback row must therefore pass this
 * strict check: the place AND the business type must both be in the lead.
 *
 * Rules (deliberately strict — a miss just means a real scrape runs):
 * - Words match whole-word only, after the same light singularizing on both
 *   sides. No prefix matching: "bar" must never match "barber".
 * - Google Maps: every topic word (minus filler like "places", "shop") must
 *   be in the lead's name / category text.
 * - LinkedIn / B2B: if job titles were asked for, at least one title must
 *   fully match; every industry and keyword word must match too.
 * - No usable topic or no place → nothing from the fallback.
 */

export type MatchFilters = {
  industry?: string | null;
  jobTitles?: string[];
  country?: string | null;
  region?: string | null;
  city?: string | null;
  keywords?: string[];
  mapsSearchString?: string | null;
  locationQuery?: string | null;
};

/** Words that describe "a business" but not which kind. */
const FILLER = new Set([
  "a", "an", "the", "and", "or", "of", "for", "in", "near", "around", "at", "to",
  "best", "top", "good", "local", "nearby", "area",
  "place", "spot", "business", "company", "shop", "store", "service", "office",
  "agency", "firm",
]);

/**
 * Common wording differences between what people type and Maps categories.
 * Each alias is a phrase whose words must ALL be present ("real estate"),
 * so a single generic word can never stand in for a business type.
 */
const ALIASES: Record<string, string[]> = {
  med: ["medical"],
  medical: ["med"],
  dentist: ["dental"],
  dental: ["dentist"],
  lawyer: ["attorney", "law"],
  attorney: ["lawyer", "law"],
  gym: ["fitness"],
  realtor: ["real estate"],
  restaurant: ["eatery", "diner", "bistro", "grill", "steakhouse", "steak house", "pizzeria", "taqueria"],
  cafe: ["coffee"],
  coffee: ["cafe"],
};

/** Lowercase, strip punctuation, light singular ("bakeries" → "bakery", "spas" → "spa"). */
export function stemWords(text: string | null | undefined): string[] {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(stem);
}

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("ie")) return `${w.slice(0, -2)}y`; // older keys stored "bakerie"
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function meaningful(text: string | null | undefined): string[] {
  return stemWords(text).filter((w) => !FILLER.has(w));
}

function hasWord(leadWords: Set<string>, word: string): boolean {
  if (leadWords.has(word)) return true;
  return (ALIASES[word] ?? []).some((phrase) => phrase.split(" ").every((a) => leadWords.has(a)));
}

function allIn(leadWords: Set<string>, words: string[]): boolean {
  return words.every((w) => hasWord(leadWords, w));
}

/** Where the search targets (city first), as words. Empty = no place given. */
export function placeWords(f: MatchFilters): string[] {
  const place = f.city ?? f.locationQuery?.split(",")[0] ?? f.region ?? f.country;
  return meaningful(place);
}

export type LeadText = {
  name?: string;
  company?: string;
  title?: string;
  industry?: string;
  location?: string;
  searchText?: string;
};

/**
 * True only when the lead is in the searched place AND is the searched kind
 * of business/person. Used to gate every keyword-fallback library row.
 */
export function leadMatchesSearch(source: string, f: MatchFilters, lead: LeadText): boolean {
  if (source === "realtor_agents") return false; // realtor searches are ZIP-exact only

  const place = placeWords(f);
  if (place.length === 0) return false;

  // Place comes from the address, not the name ("Miami Cuts" in Orlando ≠ Miami).
  const locationWords = new Set(stemWords(lead.location?.trim() ? lead.location : lead.searchText));
  if (!place.every((w) => locationWords.has(w))) return false;

  // Topic is checked against what the business IS (name/category/title),
  // never its location — "Miami Grill" shouldn't pass on the word "miami".
  const topicWords = new Set(
    stemWords([lead.name, lead.company, lead.title, lead.industry].join(" ")),
  );

  if (source === "google_maps") {
    const topic = meaningful(f.mapsSearchString ?? [f.industry, ...(f.keywords ?? [])].join(" "))
      .filter((w) => !place.includes(w));
    if (topic.length === 0) return false;
    return allIn(topicWords, topic);
  }

  // LinkedIn / Explorium people searches.
  const titles = (f.jobTitles ?? []).map(meaningful).filter((t) => t.length > 0);
  const industry = meaningful(f.industry);
  const keywords = (f.keywords ?? []).flatMap(meaningful);
  if (titles.length === 0 && industry.length === 0 && keywords.length === 0) return false;
  if (titles.length > 0 && !titles.some((t) => allIn(topicWords, t))) return false;
  if (!allIn(topicWords, industry)) return false;
  if (!allIn(topicWords, keywords)) return false;
  return true;
}
