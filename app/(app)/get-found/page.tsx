import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { AuditTab } from "@/components/tools/tools-client";

export default function GetFoundPage() {
  return (
    <LivePage>
      <PageHeader
        title="Get Found by AI"
        description="See how AI assistants and Google describe your business, spot the competitors they recommend instead, and get the fixes — every audit is saved."
      />
      <AuditTab />
    </LivePage>
  );
}
