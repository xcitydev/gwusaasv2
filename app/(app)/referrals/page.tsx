import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { TourLauncher } from "@/components/tour/tour";
import { REFERRALS_TOUR } from "@/components/tour/tours";
import { ReferralsClient } from "@/components/referrals/referrals-client";

export default function ReferralsPage() {
  return (
    <LivePage>
      <PageHeader
        title="Referrals"
        description="Share your link, earn 50% when someone you refer subscribes."
        actions={<TourLauncher tour={REFERRALS_TOUR} />}
      />
      <ReferralsClient />
    </LivePage>
  );
}
