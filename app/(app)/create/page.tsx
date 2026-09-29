import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { TourLauncher } from "@/components/tour/tour";
import { CREATE_TOUR } from "@/components/tour/tours";
import { CreateClient } from "@/components/create/create-client";

export default function CreatePage() {
  return (
    <LivePage>
      <PageHeader
        title="Create with AI"
        description="Tell the AI Hub what you want. It picks the model, shows the price, and renders here. Advanced tabs give you every knob."
        actions={<TourLauncher tour={CREATE_TOUR} />}
      />
      <CreateClient />
    </LivePage>
  );
}
