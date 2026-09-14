import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { CreateClient } from "@/components/create/create-client";

export default function CreatePage() {
  return (
    <LivePage>
      <PageHeader
        title="Create with AI"
        description="Generate images and videos with the most powerful models — priced per generation in credits."
      />
      <CreateClient />
    </LivePage>
  );
}
