/**
 * Credit top-up packs. Shared by the server (quote + checkout metadata) and
 * the client (pack picker). Face value is always creditPriceUsd per credit
 * (1 credit = 1 cent by default); packs add BONUS credits, never a discount
 * on cash, so Whop always shows a clean round price.
 */
export const MIN_TOPUP_CREDITS = 1000;
export const MAX_TOPUP_CREDITS = 1_000_000;

export type CreditPack = {
  id: string;
  name: string;
  credits: number;
  bonusPercent: number;
};

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: "starter", name: "Starter", credits: 1_000, bonusPercent: 0 },
  { id: "growth", name: "Growth", credits: 5_000, bonusPercent: 5 },
  { id: "pro", name: "Pro", credits: 10_000, bonusPercent: 10 },
  { id: "scale", name: "Scale", credits: 25_000, bonusPercent: 15 },
];

export type TopupQuote = {
  packId: string | null;
  packName: string | null;
  baseCredits: number;
  bonusCredits: number;
  totalCredits: number;
  usd: number;
};

/** Price a top-up. A bonus applies only when the amount is exactly a pack size. */
export function quoteTopup(credits: number, creditPriceUsd: number): TopupQuote {
  const base = Math.round(credits);
  if (!Number.isFinite(base) || base < MIN_TOPUP_CREDITS || base > MAX_TOPUP_CREDITS) {
    throw new Error(
      `Credit top-ups are between ${MIN_TOPUP_CREDITS.toLocaleString()} and ${MAX_TOPUP_CREDITS.toLocaleString()} credits.`,
    );
  }
  const pack = CREDIT_PACKS.find((p) => p.credits === base) ?? null;
  const bonusCredits = pack ? Math.round((base * pack.bonusPercent) / 100) : 0;
  const usd = Math.round(base * creditPriceUsd * 100) / 100;
  return {
    packId: pack?.id ?? null,
    packName: pack?.name ?? null,
    baseCredits: base,
    bonusCredits,
    totalCredits: base + bonusCredits,
    usd,
  };
}

/** Parse the shortfall out of a server "INSUFFICIENT_CREDITS: need N, have M" error. */
export function parseShortfall(message: string): { need: number; have: number } | null {
  const m = message.match(/INSUFFICIENT_CREDITS:\s*need\s+(\d+),\s*have\s+(\d+)/);
  return m ? { need: Number(m[1]), have: Number(m[2]) } : null;
}
