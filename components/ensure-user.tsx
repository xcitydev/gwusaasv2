"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

const REF_KEY = "referral-code";

/**
 * Rendered once inside the signed-in app layout. Captures ?ref= codes for
 * referral attribution and upserts the Convex user after Clerk authenticates.
 */
export function EnsureUser() {
  const { isAuthenticated } = useConvexAuth();
  const { has } = useAuth();
  const ensureUser = useMutation(api.users.ensureUser);
  const syncPlan = useMutation(api.billing.syncPlan);

  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref) localStorage.setItem(REF_KEY, ref);
    } catch {
      // Storage unavailable — referral attribution is best-effort.
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let referralCode: string | undefined;
    try {
      referralCode = localStorage.getItem(REF_KEY) ?? undefined;
    } catch {
      referralCode = undefined;
    }
    void ensureUser({ referralCode }).then(() => {
      try {
        localStorage.removeItem(REF_KEY);
      } catch {
        // ignore
      }
    });
  }, [isAuthenticated, ensureUser]);

  // Mirror the Clerk Billing plan into Convex (grants plan credits once,
  // qualifies the referrer's one-time 30% payout).
  useEffect(() => {
    if (!isAuthenticated || !has) return;
    const plan = has({ plan: "team" })
      ? ("team" as const)
      : has({ plan: "personal" })
        ? ("personal" as const)
        : ("free" as const);
    void syncPlan({ plan }).catch(() => {
      // Billing not configured yet — plan stays as-is.
    });
  }, [isAuthenticated, has, syncPlan]);

  return null;
}
