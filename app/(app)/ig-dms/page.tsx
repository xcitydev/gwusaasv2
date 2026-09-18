import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { IgDmsClient } from "@/components/ig/ig-dms-client";

export default function IgDmsPage() {
  return (
    <LivePage>
      <PageHeader
        title="IG DMs"
        description="Every Instagram DM in one inbox — reply yourself or let AI answer in your brand voice."
      />
      <IgDmsClient />
    </LivePage>
  );
}
