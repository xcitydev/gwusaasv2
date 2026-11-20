/**
 * Where (in time) is a lead outside the US/Canada? Read from the country
 * calling code on their E.164 number, so each lead is called 9am–8pm in
 * THEIR country — even when one campaign mixes countries.
 *
 * Countries spanning several time zones can't be placed from the number
 * alone. For those, the campaign's default zone is used only when it lies
 * in that country; otherwise the lead is held (never risk a night call).
 *
 * Pure module: no Convex/runtime imports, unit-tested by
 * lib/calling-zones.test.ts.
 */

/** Calling code → the country's (single) time zone. */
const SINGLE_ZONE: Record<string, string> = {
  // Europe
  "44": "Europe/London", "353": "Europe/Dublin", "49": "Europe/Berlin", "33": "Europe/Paris",
  "34": "Europe/Madrid", "39": "Europe/Rome", "31": "Europe/Amsterdam", "32": "Europe/Brussels",
  "41": "Europe/Zurich", "43": "Europe/Vienna", "45": "Europe/Copenhagen", "46": "Europe/Stockholm",
  "47": "Europe/Oslo", "358": "Europe/Helsinki", "48": "Europe/Warsaw", "351": "Europe/Lisbon",
  "30": "Europe/Athens", "420": "Europe/Prague", "36": "Europe/Budapest", "40": "Europe/Bucharest",
  "380": "Europe/Kiev", "90": "Europe/Istanbul", "352": "Europe/Luxembourg", "356": "Europe/Malta",
  "354": "Atlantic/Reykjavik", "385": "Europe/Zagreb", "381": "Europe/Belgrade", "359": "Europe/Sofia",
  // Middle East / Asia
  "972": "Asia/Jerusalem", "971": "Asia/Dubai", "966": "Asia/Riyadh", "974": "Asia/Qatar",
  "965": "Asia/Kuwait", "973": "Asia/Bahrain", "968": "Asia/Muscat", "962": "Asia/Amman",
  "961": "Asia/Beirut", "91": "Asia/Kolkata", "92": "Asia/Karachi", "880": "Asia/Dhaka",
  "94": "Asia/Colombo", "977": "Asia/Kathmandu", "81": "Asia/Tokyo", "82": "Asia/Seoul",
  "86": "Asia/Shanghai", "852": "Asia/Hong_Kong", "853": "Asia/Macau", "886": "Asia/Taipei",
  "65": "Asia/Singapore", "60": "Asia/Kuala_Lumpur", "63": "Asia/Manila", "66": "Asia/Bangkok",
  "84": "Asia/Ho_Chi_Minh", "855": "Asia/Phnom_Penh",
  // Oceania (single-zone)
  "64": "Pacific/Auckland", "679": "Pacific/Fiji",
  // Africa
  "234": "Africa/Lagos", "233": "Africa/Accra", "254": "Africa/Nairobi", "256": "Africa/Kampala",
  "255": "Africa/Dar_es_Salaam", "250": "Africa/Kigali", "251": "Africa/Addis_Ababa",
  "27": "Africa/Johannesburg", "20": "Africa/Cairo", "212": "Africa/Casablanca",
  "213": "Africa/Algiers", "216": "Africa/Tunis", "237": "Africa/Douala", "225": "Africa/Abidjan",
  "221": "Africa/Dakar", "263": "Africa/Harare", "260": "Africa/Lusaka", "265": "Africa/Blantyre",
  "267": "Africa/Gaborone", "264": "Africa/Windhoek", "230": "Indian/Mauritius",
  "229": "Africa/Porto-Novo", "228": "Africa/Lome", "232": "Africa/Freetown", "231": "Africa/Monrovia",
  // Latin America (single-zone)
  "57": "America/Bogota", "51": "America/Lima", "54": "America/Argentina/Buenos_Aires",
  "58": "America/Caracas", "506": "America/Costa_Rica", "507": "America/Panama",
  "502": "America/Guatemala", "503": "America/El_Salvador", "504": "America/Tegucigalpa",
  "505": "America/Managua", "591": "America/La_Paz", "595": "America/Asuncion",
  "598": "America/Montevideo",
};

/**
 * Countries with several zones: the zones that count as "in" the country,
 * so a matching campaign default can be trusted.
 */
const MULTI_ZONE: Record<string, { country: string; inCountry: (zone: string) => boolean }> = {
  "61": { country: "Australia", inCountry: (z) => z.startsWith("Australia/") },
  "55": {
    country: "Brazil",
    inCountry: (z) =>
      [
        "America/Sao_Paulo", "America/Bahia", "America/Fortaleza", "America/Recife",
        "America/Belem", "America/Maceio", "America/Araguaina", "America/Manaus",
        "America/Cuiaba", "America/Campo_Grande", "America/Porto_Velho", "America/Boa_Vista",
        "America/Rio_Branco", "America/Eirunepe", "America/Noronha", "America/Santarem",
      ].includes(z),
  },
  "52": {
    country: "Mexico",
    inCountry: (z) =>
      [
        "America/Mexico_City", "America/Cancun", "America/Merida", "America/Monterrey",
        "America/Matamoros", "America/Chihuahua", "America/Ciudad_Juarez", "America/Ojinaga",
        "America/Mazatlan", "America/Hermosillo", "America/Tijuana", "America/Bahia_Banderas",
      ].includes(z),
  },
  "62": {
    country: "Indonesia",
    inCountry: (z) => ["Asia/Jakarta", "Asia/Pontianak", "Asia/Makassar", "Asia/Jayapura"].includes(z),
  },
  "7": {
    country: "Russia/Kazakhstan",
    inCountry: (z) => z.startsWith("Asia/Almaty") || /^(Europe|Asia)\//.test(z),
  },
  "56": {
    country: "Chile",
    inCountry: (z) => ["America/Santiago", "America/Punta_Arenas", "Pacific/Easter"].includes(z),
  },
  "593": {
    country: "Ecuador",
    inCountry: (z) => ["America/Guayaquil", "Pacific/Galapagos"].includes(z),
  },
};

export type CountryZone =
  /** Placed: call in this zone. */
  | { zone: string }
  /** Multi-zone country and the campaign default isn't in it: hold the lead. */
  | { hold: string }
  /** Not determinable from the number (+1, unknown code): caller decides. */
  | null;

/** Longest calling-code prefix wins (+353 before +35, +1 is NANP). */
export function countryZone(e164: string | null, fallback: string): CountryZone {
  if (!e164?.startsWith("+") || e164.startsWith("+1")) return null;
  const digits = e164.slice(1);
  for (const len of [3, 2, 1]) {
    const code = digits.slice(0, len);
    if (SINGLE_ZONE[code]) return { zone: SINGLE_ZONE[code] };
    const multi = MULTI_ZONE[code];
    if (multi) return multi.inCountry(fallback) ? { zone: fallback } : { hold: multi.country };
  }
  return null;
}
