"use client";

import { useEffect } from "react";
import { INVITE_STORAGE_KEY } from "@/lib/invite-codes";

/**
 * Mounted in the ROOT layout so `?ref=` is captured on ANY landing URL —
 * critically /sign-up?ref=…, which renders before the signed-in shell (and
 * its EnsureUser) ever mounts. The code waits in localStorage until
 * EnsureUser attributes it after the first authenticated visit.
 */
export function CaptureReferral() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref) localStorage.setItem("referral-code", ref);
      // Forms invite code (/sign-up?invite=GWU-XXXX-XXXX) — redeemed by
      // EnsureUser once the account exists.
      const invite = params.get("invite");
      if (invite) localStorage.setItem(INVITE_STORAGE_KEY, invite);
    } catch {
      // Storage unavailable — referral attribution is best-effort.
    }
  }, []);
  return null;
}
