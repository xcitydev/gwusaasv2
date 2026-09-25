import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { CarouselTab } from "@/components/tools/tools-client";

export default function CarouselsPage() {
  return (
    <LivePage>
      <PageHeader
        title="IG Carousels"
        description="Pick a design, let AI write the slides, edit any line, and export Instagram-ready PNGs."
      />
      <CarouselTab />
    </LivePage>
  );
}
