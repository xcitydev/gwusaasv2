"use client";

import { useSyncExternalStore } from "react";
import { formatInviteCode, INVITE_STORAGE_KEY, normalizeInviteCode } from "@/lib/invite-codes";

/**
 * The forms invite this visitor is carrying, if any — from ?invite= on the
 * current URL or the code /join/<code> stashed in localStorage. Null on the
 * server and when there is none, so the auth pages render the normal variant
 * first and switch to the invite variant on the client.
 */
export function usePendingInvite(): string | null {
  return useSyncExternalStore(subscribe, readInvite, () => null);
}

function readInvite(): string | null {
  try {
    const raw =
      new URLSearchParams(window.location.search).get("invite") ??
      localStorage.getItem(INVITE_STORAGE_KEY);
    return raw ? formatInviteCode(normalizeInviteCode(raw)) : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
