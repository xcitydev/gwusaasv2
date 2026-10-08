import type { Metadata } from "next";
import { Landing } from "@/components/marketing/landing";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND.name} — Your whole growth team, run by AI`,
  description:
    "Cold email that books, leads found for you, an AI receptionist in your cloned voice, Instagram DMs on autopilot, meeting notes and a full creative studio — one workspace, one balance.",
};

/**
 * Public homepage. Prerendered static (no session read here): proxy.ts
 * redirects signed-in visitors to /dashboard before this page is served.
 */
export default function Home() {
  return <Landing />;
}
