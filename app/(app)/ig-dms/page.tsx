import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { planGate } from "@/lib/plan-gate";
import { TourLauncher } from "@/components/tour/tour";
import { IG_DMS_TOUR } from "@/components/tour/tours";
import { IgDmsClient } from "@/components/ig/ig-dms-client";

export default async function IgDmsPage() {
  const gate = await planGate("/ig-dms");
  if (gate) return gate;
  return (
    <LivePage>
      <PageHeader
        title="IG DMs & AI Voice"
        description="Manage messages and automations, and send AI voice DMs in your cloned voice."
        actions={<TourLauncher tour={IG_DMS_TOUR} />}
      />
      <IgDmsClient />
    </LivePage>
  );
}
