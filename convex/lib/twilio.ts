/**
 * Twilio adapter — phone numbers for the ElevenLabs call route. ElevenLabs
 * Agents can't sell numbers; they take a Twilio number we own and import.
 * No-op guard until TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are set.
 * Docs: https://www.twilio.com/docs/phone-numbers/api
 */

const BASE = "https://api.twilio.com/2010-04-01";

export function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/** Account SID + auth token — ElevenLabs needs both to import a number. */
export function twilioCredentials(): { sid: string; token: string } {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("NOT_CONFIGURED: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set");
  }
  return { sid, token };
}

async function call<T>(
  path: string,
  init?: { method?: string; form?: Record<string, string> },
): Promise<T> {
  const { sid, token } = twilioCredentials();
  const res = await fetch(`${BASE}/Accounts/${sid}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      ...(init?.form && { "Content-Type": "application/x-www-form-urlencoded" }),
    },
    body: init?.form ? new URLSearchParams(init.form).toString() : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    console.error(`Twilio ${res.status} on ${path}: ${text.slice(0, 500)}`);
    let detail = text.slice(0, 200);
    try {
      detail = String((JSON.parse(text) as { message?: string }).message ?? detail);
    } catch {
      // Keep the raw body.
    }
    throw new Error(`Twilio ${res.status}: ${detail}`);
  }
  return JSON.parse(text) as T;
}

type AvailableNumber = {
  phone_number: string;
  friendly_name: string;
  locality: string | null;
  region: string | null;
};

/** US local numbers in stock, optionally in one area code. */
export async function listAvailableNumbers(
  areaCode?: string,
): Promise<{ phone_number: string; friendly_name: string; location: string }[]> {
  const code = areaCode?.replace(/\D/g, "").slice(0, 3);
  const query = new URLSearchParams({ PageSize: "20", VoiceEnabled: "true" });
  if (code && code.length === 3) query.set("AreaCode", code);
  const result = await call<{ available_phone_numbers?: AvailableNumber[] }>(
    `/AvailablePhoneNumbers/US/Local.json?${query}`,
  );
  return (result.available_phone_numbers ?? []).map((n) => ({
    phone_number: n.phone_number,
    friendly_name: n.friendly_name,
    location: [n.locality, n.region].filter(Boolean).join(", "),
  }));
}

/** Buy a specific number (E.164). Returns its Twilio SID. */
export async function purchaseNumber(phoneNumber: string): Promise<{ sid: string; number: string }> {
  const result = await call<{ sid: string; phone_number: string }>(
    "/IncomingPhoneNumbers.json",
    { method: "POST", form: { PhoneNumber: phoneNumber } },
  );
  return { sid: result.sid, number: result.phone_number };
}

/** Give a number back to Twilio (stops its monthly charge). */
export async function releaseNumber(sid: string): Promise<void> {
  await call(`/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`, { method: "DELETE" });
}
