import { Suspense } from "react";
import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { ToolsClient } from "@/components/tools/tools-client";

export default function ToolsPage() {
  return (
    <LivePage>
      <PageHeader
        title="AI Tools"
        description="Audit how AI and Google see your business, find competitors, and transcribe any audio — results saved forever."
      />
      {/* Suspense: ToolsClient reads useSearchParams for the active tab. */}
      <Suspense fallback={null}>
        <ToolsClient />
      </Suspense>
    </LivePage>
  );
}
