/** Invite codes unlock the GWU Onboarding Forms. Shared by Convex + UI. */

/** Canonical form: uppercase alphanumerics only ("gwu-7k3m p9qa" → "GWU7K3MP9QA"). */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Generated codes read as GWU-XXXX-XXXX; custom codes are shown as typed. */
export function formatInviteCode(code: string): string {
  return /^GWU[A-Z0-9]{8}$/.test(code)
    ? `GWU-${code.slice(3, 7)}-${code.slice(7)}`
    : code;
}

export const INVITE_CODE_MIN = 4;
export const INVITE_CODE_MAX = 24;
export const INVITE_STORAGE_KEY = "invite-code";
