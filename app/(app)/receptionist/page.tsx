import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { ReceptionistClient } from "@/components/voice/receptionist-client";

export default function ReceptionistPage() {
  return (
    <LivePage>
      <PageHeader
        title="AI Receptionist"
        description="An AI that answers your business line — you write the prompt, it takes the calls."
      />
      <ReceptionistClient />
    </LivePage>
  );
}
