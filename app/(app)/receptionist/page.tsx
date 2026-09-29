import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { TourLauncher } from "@/components/tour/tour";
import { RECEPTIONIST_TOUR } from "@/components/tour/tours";
import { ReceptionistClient } from "@/components/voice/receptionist-client";

export default function ReceptionistPage() {
  return (
    <LivePage>
      <PageHeader
        title="AI Receptionist"
        description="An AI that answers your business line — you write the prompt, it takes the calls."
        actions={<TourLauncher tour={RECEPTIONIST_TOUR} />}
      />
      <ReceptionistClient />
    </LivePage>
  );
}
