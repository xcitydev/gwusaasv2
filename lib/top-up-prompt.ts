/**
 * App-wide "top up credits" prompt. Any feature that hits INSUFFICIENT_CREDITS
 * calls promptTopUpIfInsufficient(error) and the dialog mounted in the app
 * shell opens with the exact shortfall. Tiny external store, no context
 * plumbing needed.
 */
import { parseShortfall } from "@/lib/credit-packs";

export type TopUpRequest = {
  /** Credits the blocked action needed, when the server said. */
  need?: number;
  /** Balance at the time, when the server said. */
  have?: number;
  /** One line naming what was blocked, e.g. "Rendering this carousel". */
  context?: string;
};

let current: TopUpRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function openTopUp(request: TopUpRequest = {}): void {
  current = { ...request };
  emit();
}

export function closeTopUp(): void {
  current = null;
  emit();
}

export function subscribeTopUp(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTopUpRequest(): TopUpRequest | null {
  return current;
}

/**
 * If the error is a credit shortfall, open the prompt with the numbers and
 * return true (the caller can skip its generic toast). Otherwise false.
 */
export function promptTopUpIfInsufficient(error: unknown, context?: string): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message.includes("INSUFFICIENT_CREDITS")) return false;
  const shortfall = parseShortfall(message);
  openTopUp({ need: shortfall?.need, have: shortfall?.have, context });
  return true;
}
