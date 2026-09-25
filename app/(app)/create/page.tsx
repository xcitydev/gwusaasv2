import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { CreateClient } from "@/components/create/create-client";

export default function CreatePage() {
  return (
    <LivePage>
      <PageHeader
        title="Create with AI"
        description="Tell the AI Hub what you want. It picks the model, shows the price, and renders here. Advanced tabs give you every knob."
      />
      <CreateClient />
    </LivePage>
  );
}
