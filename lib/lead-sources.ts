/**
 * Lead source registry. The AI router picks one per search; users can
 * override. Credit costs come from admin config by tier.
 */

export type LeadSourceId =
  | "google_maps"
  | "linkedin"
  | "explorium"
  | "realtor_agents"
  | "sample";

export const LEAD_SOURCES: {
  id: LeadSourceId;
  label: string;
  blurb: string;
  costTier: "leadCreditCostMaps" | "leadCreditCostB2B" | "leadCreditCostNiche";
  etaLabel: string;
}[] = [
  {
    id: "google_maps",
    label: "Google Maps",
    blurb: "Local businesses — name, phone, website, email where available.",
    costTier: "leadCreditCostMaps",
    etaLabel: "usually 1–3 minutes",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    blurb: "Professionals by job title and location, with verified emails — the go-to for B2B.",
    costTier: "leadCreditCostB2B",
    etaLabel: "usually 2–5 minutes",
  },
  {
    id: "explorium",
    label: "B2B Database",
    blurb: "Premium contacts with mobile phone numbers — best for call lists.",
    costTier: "leadCreditCostB2B",
    etaLabel: "usually under a minute",
  },
  {
    id: "realtor_agents",
    label: "Realtor.com Agents",
    blurb: "US real-estate agents by ZIP code.",
    costTier: "leadCreditCostNiche",
    etaLabel: "usually 1–2 minutes",
  },
];

export function leadSourceMeta(id: string | undefined) {
  return (
    LEAD_SOURCES.find((s) => s.id === id) ?? {
      id: "sample" as const,
      label: "Sample data",
      blurb: "Placeholder results while providers are being connected.",
      costTier: "leadCreditCostMaps" as const,
      etaLabel: "instant",
    }
  );
}
