import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { TourLauncher } from "@/components/tour/tour";
import { CAROUSELS_TOUR } from "@/components/tour/tours";
import { CarouselTab } from "@/components/tools/tools-client";

export default function CarouselsPage() {
  return (
    <LivePage>
      <PageHeader
        title="IG Carousels"
        description="Pick a design, let AI write the slides, edit any line, and export Instagram-ready PNGs."
        actions={<TourLauncher tour={CAROUSELS_TOUR} />}
      />
      <CarouselTab />
    </LivePage>
  );
}
