import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { TourLauncher } from "@/components/tour/tour";
import { VOICES_TOUR } from "@/components/tour/tours";
import { VoicesTab } from "@/components/voice/voices-tab";

export default function VoicesPage() {
  return (
    <LivePage>
      <PageHeader
        title="Clone Your Voice"
        description="Use it across the AI Receptionist, Lead Qualifier, IG DMs and AI Cold Calling — clone it once, then set it up to run on auto."
        actions={<TourLauncher tour={VOICES_TOUR} />}
      />
      <VoicesTab />
    </LivePage>
  );
}
