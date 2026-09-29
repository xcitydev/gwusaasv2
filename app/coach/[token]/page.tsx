import type { Metadata } from "next";
import { CoachCard } from "@/components/note-taker/coach-card";

export const metadata: Metadata = {
  title: "Agenda coach",
  robots: { index: false, follow: false },
};

/**
 * Public, token-gated page the meeting bot streams as its camera feed.
 * No app shell, no sign-in: the token in the URL is the only key, and the
 * page only reveals the agenda and the coach's live verdict.
 */
export default async function CoachCardPage({ params }: PageProps<"/coach/[token]">) {
  const { token } = await params;
  return <CoachCard token={token} />;
}
