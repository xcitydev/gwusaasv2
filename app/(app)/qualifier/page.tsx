import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { QualifierClient } from "@/components/voice/qualifier-client";

export default function QualifierPage() {
  return (
    <LivePage>
      <PageHeader
        title="AI Lead Qualifier"
        description="The AI calls your imported leads and qualifies them before you ever pick up the phone."
      />
      <QualifierClient />
    </LivePage>
  );
}
