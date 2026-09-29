import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { TourLauncher } from "@/components/tour/tour";
import { GET_FOUND_TOUR } from "@/components/tour/tours";
import { AuditTab } from "@/components/tools/tools-client";

export default function GetFoundPage() {
  return (
    <LivePage>
      <PageHeader
        title="Get Found by AI"
        description="See how AI assistants and Google describe your business, spot the competitors they recommend instead, and get the fixes — every audit is saved."
        actions={<TourLauncher tour={GET_FOUND_TOUR} />}
      />
      <AuditTab />
    </LivePage>
  );
}
