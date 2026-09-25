import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { VoicesTab } from "@/components/voice/voices-tab";

export default function VoicesPage() {
  return (
    <LivePage>
      <PageHeader
        title="Clone Your Voice"
        description="Use it across the AI Receptionist, Lead Qualifier, IG DMs and AI Cold Calling — clone it once, then set it up to run on auto."
      />
      <VoicesTab />
    </LivePage>
  );
}
