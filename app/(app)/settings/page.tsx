import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { SettingsClient } from "@/components/settings/settings-client";

export default function SettingsPage() {
  return (
    <LivePage>
      <PageHeader
        title="Settings"
        description="Your plan, credits and account."
      />
      <SettingsClient />
    </LivePage>
  );
}
