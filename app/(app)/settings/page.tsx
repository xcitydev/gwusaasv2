import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { TourLauncher } from "@/components/tour/tour";
import { SETTINGS_TOUR } from "@/components/tour/tours";
import { SettingsClient } from "@/components/settings/settings-client";

/** /settings?tab=account opens the Account tab (dashboard + invite links use it). */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { tab } = await searchParams;
  const defaultTab =
    tab === "account" ? "account" : tab === "integrations" ? "integrations" : "billing";
  return (
    <LivePage>
      <PageHeader
        title="Settings"
        description="Your plan, credits and account."
        actions={<TourLauncher tour={SETTINGS_TOUR} />}
      />
      <SettingsClient defaultTab={defaultTab} />
    </LivePage>
  );
}
