/**
 * Campaign scheduling timezones. Instantly's API only accepts a frozen enum
 * of ~102 zone names — many famous zones (America/New_York, Europe/London,
 * UTC…) are NOT in it. Every value below was live-verified against their
 * campaign validator on 2026-08-31; labels show the clock users care about.
 */

export const CAMPAIGN_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Detroit", label: "US Eastern (New York)" },
  { value: "America/Chicago", label: "US Central (Chicago)" },
  { value: "America/Boise", label: "US Mountain (Denver)" },
  { value: "America/Creston", label: "US Arizona (Phoenix, no DST)" },
  { value: "America/Dawson", label: "US Pacific (Los Angeles)" },
  { value: "Europe/Sarajevo", label: "Central Europe (Berlin, Paris)" },
  { value: "Asia/Dubai", label: "Gulf (Dubai)" },
  { value: "Asia/Kolkata", label: "India (Mumbai, Delhi)" },
  { value: "Asia/Hong_Kong", label: "East Asia (Singapore, Hong Kong)" },
  { value: "Asia/Dili", label: "Japan / Korea (Tokyo, Seoul)" },
  { value: "Australia/Brisbane", label: "Australia (Brisbane, no DST)" },
  { value: "Australia/Melbourne", label: "Australia (Sydney, Melbourne)" },
];

export const DEFAULT_CAMPAIGN_TIMEZONE = "America/Detroit";

const ALLOWED = new Set(CAMPAIGN_TIMEZONES.map((t) => t.value));

/** Zones stored before the enum was discovered → nearest allowed equivalent. */
const LEGACY_MAP: Record<string, string> = {
  "America/New_York": "America/Detroit",
  "America/Denver": "America/Boise",
  "America/Los_Angeles": "America/Dawson",
  "America/Phoenix": "America/Creston",
  "Europe/Berlin": "Europe/Sarajevo",
  // No UTC+0 zone exists in Instantly's enum; Central Europe is the closest.
  "Europe/London": "Europe/Sarajevo",
  UTC: "Europe/Sarajevo",
  "Etc/UTC": "Europe/Sarajevo",
  "Australia/Sydney": "Australia/Melbourne",
  "Asia/Tokyo": "Asia/Dili",
  "Asia/Singapore": "Asia/Hong_Kong",
};

/** Guarantee a value Instantly's validator accepts. */
export function toEngineTimezone(timezone: string): string {
  if (ALLOWED.has(timezone)) return timezone;
  return LEGACY_MAP[timezone] ?? "America/Chicago";
}
