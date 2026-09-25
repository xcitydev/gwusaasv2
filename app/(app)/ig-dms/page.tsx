import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { IgDmsClient } from "@/components/ig/ig-dms-client";

export default function IgDmsPage() {
  return (
    <LivePage>
      <PageHeader
        title="IG DMs & AI Voice"
        description="Manage messages and automations, and send AI voice DMs in your cloned voice."
      />
      <IgDmsClient />
    </LivePage>
  );
}
