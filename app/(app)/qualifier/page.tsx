import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { QualifierClient } from "@/components/voice/qualifier-client";

export default function QualifierPage() {
  return (
    <LivePage>
      <PageHeader
        title="AI Cold Calling"
        description="Use your cloned voice, set it up to run on auto — the AI calls your leads and tells you who is worth your time."
      />
      <QualifierClient />
    </LivePage>
  );
}
