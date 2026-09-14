import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { AiSearch } from "@/components/leads/ai-search";
import { LeadsTable } from "@/components/leads/leads-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function LeadsPage() {
  return (
    <LivePage>
      <PageHeader
        title="Find Customers"
        description="Search for leads in plain English, keep them all in one deduped list."
      />
      <Tabs defaultValue="search">
        <TabsList className="mb-4">
          <TabsTrigger value="search">AI Search</TabsTrigger>
          <TabsTrigger value="leads">My Leads</TabsTrigger>
        </TabsList>
        <TabsContent value="search">
          <AiSearch />
        </TabsContent>
        <TabsContent value="leads">
          <LeadsTable />
        </TabsContent>
      </Tabs>
    </LivePage>
  );
}
