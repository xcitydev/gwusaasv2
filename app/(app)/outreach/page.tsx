import {
  Inbox,
  Megaphone,
  MailOpen,
  BarChart3,
  Settings2,
  MessageSquareText,
} from "lucide-react";
import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InboxesTab } from "@/components/outreach/inboxes-tab";
import { CampaignsTab } from "@/components/outreach/campaigns-tab";
import { MasterInboxTab } from "@/components/outreach/master-inbox-tab";
import { AnalyticsTab } from "@/components/outreach/analytics-tab";
import { SettingsTab } from "@/components/outreach/settings-tab";

export default function OutreachPage() {
  return (
    <LivePage>
      <PageHeader
        title="Outreach"
        description="Cold email engine — inboxes, campaigns, unified replies and analytics."
        actions={
          <Badge variant="outline" className="border-primary/40 text-primary">
            <MessageSquareText className="size-3" /> SMS — Coming soon
          </Badge>
        }
      />
      <Tabs defaultValue="inboxes">
        <TabsList className="mb-4 w-full justify-start overflow-x-auto scrollbar-none">
          <TabsTrigger value="inboxes" className="gap-1.5">
            <Inbox className="size-4" /> Inboxes
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-1.5">
            <Megaphone className="size-4" /> Campaigns
          </TabsTrigger>
          <TabsTrigger value="master-inbox" className="gap-1.5">
            <MailOpen className="size-4" /> Master Inbox
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1.5">
            <BarChart3 className="size-4" /> Analytics
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Settings2 className="size-4" /> Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inboxes"><InboxesTab /></TabsContent>
        <TabsContent value="campaigns"><CampaignsTab /></TabsContent>
        <TabsContent value="master-inbox"><MasterInboxTab /></TabsContent>
        <TabsContent value="analytics"><AnalyticsTab /></TabsContent>
        <TabsContent value="settings"><SettingsTab /></TabsContent>
      </Tabs>
    </LivePage>
  );
}
