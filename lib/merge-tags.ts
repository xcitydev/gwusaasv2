/**
 * Merge-tag engine for campaign scripts. Users write snake_case tags
 * ({{first_name}}, {{company}}…) with optional fallbacks ({{first_name|there}}).
 * The preview renders them against a real lead; at publish time they're
 * translated to Instantly's camelCase tags so personalization works on send.
 */

export type LeadLike = {
  email: string;
  name?: string;
  company?: string;
  title?: string;
  phone?: string;
  location?: string;
  industry?: string;
  website?: string;
};

export function leadFirstName(lead: LeadLike): string {
  return lead.name?.trim().split(/\s+/)[0] ?? "";
}

export function leadLastName(lead: LeadLike): string {
  const parts = lead.name?.trim().split(/\s+/) ?? [];
  return parts.slice(1).join(" ");
}

/** Our tag → value for a given lead. */
export function tagValue(tag: string, lead: LeadLike): string | undefined {
  switch (tag) {
    case "first_name":
      return leadFirstName(lead) || undefined;
    case "last_name":
      return leadLastName(lead) || undefined;
    case "name":
      return lead.name || undefined;
    case "company":
      return lead.company || undefined;
    case "title":
      return lead.title || undefined;
    case "email":
      return lead.email || undefined;
    case "phone":
      return lead.phone || undefined;
    case "location":
      return lead.location || undefined;
    case "industry":
      return lead.industry || undefined;
    case "website":
      return lead.website || undefined;
    default:
      return undefined;
  }
}

const TAG_PATTERN = /\{\{\s*([a-zA-Z_]+)\s*(?:\|([^}]*))?\}\}/g;

export type RenderedPart =
  | { kind: "text"; text: string }
  | { kind: "value"; text: string; tag: string }
  | { kind: "fallback"; text: string; tag: string }
  | { kind: "missing"; tag: string };

/** Tokenized render for the preview UI (so tags can be highlighted). */
export function renderParts(template: string, lead: LeadLike): RenderedPart[] {
  const parts: RenderedPart[] = [];
  let last = 0;
  for (const match of template.matchAll(TAG_PATTERN)) {
    if (match.index! > last) {
      parts.push({ kind: "text", text: template.slice(last, match.index) });
    }
    const [, tag, fallback] = match;
    const value = tagValue(tag, lead);
    if (value) parts.push({ kind: "value", text: value, tag });
    else if (fallback !== undefined)
      parts.push({ kind: "fallback", text: fallback, tag });
    else parts.push({ kind: "missing", tag });
    last = match.index! + match[0].length;
  }
  if (last < template.length) {
    parts.push({ kind: "text", text: template.slice(last) });
  }
  return parts;
}

/** Plain-string render (previews in toasts, plaintext contexts). */
export function renderTemplate(template: string, lead: LeadLike): string {
  return renderParts(template, lead)
    .map((p) => (p.kind === "missing" ? "" : p.text))
    .join("");
}

/**
 * Translate our snake_case tags to Instantly's camelCase equivalents,
 * preserving fallbacks. Tags without a predefined Instantly equivalent
 * (title, location, industry, name) are kept verbatim and supplied per-lead
 * as custom variables.
 */
const INSTANTLY_TAG_MAP: Record<string, string> = {
  first_name: "firstName",
  last_name: "lastName",
  company: "companyName",
};

export function toInstantlyTags(template: string): string {
  return template.replace(TAG_PATTERN, (_match, tag: string, fallback?: string) => {
    const mapped = INSTANTLY_TAG_MAP[tag] ?? tag;
    return fallback !== undefined ? `{{${mapped}|${fallback}}}` : `{{${mapped}}}`;
  });
}
