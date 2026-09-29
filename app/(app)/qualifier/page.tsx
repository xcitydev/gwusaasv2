import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { TourLauncher } from "@/components/tour/tour";
import { QUALIFIER_TOUR } from "@/components/tour/tours";
import { QualifierClient } from "@/components/voice/qualifier-client";

export default function QualifierPage() {
  return (
    <LivePage>
      <PageHeader
        title="AI Cold Calling"
        description="Use your cloned voice, set it up to run on auto — the AI calls your leads and tells you who is worth your time."
        actions={<TourLauncher tour={QUALIFIER_TOUR} />}
      />
      <QualifierClient />
    </LivePage>
  );
}
