import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { VoicesTab } from "@/components/voice/voices-tab";

export default function VoicesPage() {
  return (
    <LivePage>
      <PageHeader
        title="Voice Clones"
        description="Clone your voice from 15 seconds of talking — then your receptionist and qualifier answer calls sounding like you."
      />
      <VoicesTab />
    </LivePage>
  );
}
