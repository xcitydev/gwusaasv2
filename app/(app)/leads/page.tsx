import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { planGate } from "@/lib/plan-gate";
import { TourLauncher } from "@/components/tour/tour";
import { LEADS_TOUR } from "@/components/tour/tours";
import { AiSearch } from "@/components/leads/ai-search";
import { IgCommenters } from "@/components/leads/ig-commenters";
import { LeadsTable } from "@/components/leads/leads-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function LeadsPage() {
  const gate = await planGate("/leads");
  if (gate) return gate;
  return (
    <LivePage>
      <PageHeader
        title="Find Leads"
        description="Describe who you want in plain English — the AI scrapes Google Maps, LinkedIn and B2B databases, verifies emails, and keeps everything in one deduped list. Or paste an Instagram post and pull everyone who commented, bios included."
        actions={<TourLauncher tour={LEADS_TOUR} />}
      />
      <Tabs defaultValue="search">
        <TabsList className="mb-4">
          <TabsTrigger value="search">AI Search</TabsTrigger>
          <TabsTrigger value="ig">IG Commenters</TabsTrigger>
          <TabsTrigger value="leads" data-tour="leads-tab-leads">My Leads</TabsTrigger>
        </TabsList>
        <TabsContent value="search">
          <AiSearch />
        </TabsContent>
        <TabsContent value="ig">
          <IgCommenters />
        </TabsContent>
        <TabsContent value="leads">
          <LeadsTable />
        </TabsContent>
      </Tabs>
    </LivePage>
  );
}
