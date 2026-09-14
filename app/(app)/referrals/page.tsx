import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { ReferralsClient } from "@/components/referrals/referrals-client";

export default function ReferralsPage() {
  return (
    <LivePage>
      <PageHeader
        title="Referrals"
        description="Share your link, earn a one-time 30% when someone you refer subscribes."
      />
      <ReferralsClient />
    </LivePage>
  );
}
