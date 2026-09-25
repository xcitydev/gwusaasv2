import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Landing } from "@/components/marketing/landing";
import { BRAND } from "@/lib/brand";
import { hasClerk } from "@/lib/runtime";

export const metadata: Metadata = {
  title: `${BRAND.name} — Your whole growth team, run by AI`,
  description:
    "Cold email that books, leads found for you, an AI receptionist in your cloned voice, Instagram DMs on autopilot, meeting notes and a full creative studio — one workspace, one balance.",
};

/** Public homepage; anyone already signed in goes straight to the app. */
export default async function Home() {
  if (hasClerk) {
    const { userId } = await auth();
    if (userId) redirect("/dashboard");
  }
  return <Landing />;
}
