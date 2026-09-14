import { Id } from "@/convex/_generated/dataModel";
import { CampaignDetail } from "@/components/outreach/campaign-detail";
import { LivePage } from "@/components/live-page";

export default async function CampaignDetailPage({
  params,
}: PageProps<"/outreach/campaigns/[id]">) {
  const { id } = await params;
  return (
    <LivePage>
      <CampaignDetail campaignId={id as Id<"campaigns">} />
    </LivePage>
  );
}
