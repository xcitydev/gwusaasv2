import type { Metadata } from "next";
import { LivePage } from "@/components/live-page";
import { PlanQuiz } from "@/components/onboarding/plan-quiz";

export const metadata: Metadata = { title: "Welcome" };

export default function WelcomePage() {
  return (
    <LivePage>
      <PlanQuiz />
    </LivePage>
  );
}
