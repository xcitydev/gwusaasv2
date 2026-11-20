import { CampaignDetail } from "@/components/outreach/campaign-detail";
import { LivePage } from "@/components/live-page";
import { planGate } from "@/lib/plan-gate";

export default async function CampaignDetailPage({
  params,
}: PageProps<"/outreach/campaigns/[id]">) {
  const gate = await planGate("/outreach");
  if (gate) return gate;
  const { id } = await params;
  return (
    <LivePage>
      <CampaignDetail campaignId={id} />
    </LivePage>
  );
}
