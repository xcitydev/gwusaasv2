"use client";

import { useEffect } from "react";

/**
 * Mounted in the ROOT layout so `?ref=` is captured on ANY landing URL —
 * critically /sign-up?ref=…, which renders before the signed-in shell (and
 * its EnsureUser) ever mounts. The code waits in localStorage until
 * EnsureUser attributes it after the first authenticated visit.
 */
export function CaptureReferral() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref) localStorage.setItem("referral-code", ref);
    } catch {
      // Storage unavailable — referral attribution is best-effort.
    }
  }, []);
  return null;
}
