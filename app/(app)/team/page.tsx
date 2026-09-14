import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { TeamClient } from "@/components/team/team-client";
import { Badge } from "@/components/ui/badge";

export default function TeamPage() {
  return (
    <LivePage>
      <PageHeader
        title="Team"
        description="Add members to your agency workspace — shared leads, campaigns and credits."
        actions={
          <Badge variant="outline" className="border-primary/40 text-primary">
            Personal branding — Coming soon
          </Badge>
        }
      />
      <TeamClient />
    </LivePage>
  );
}
