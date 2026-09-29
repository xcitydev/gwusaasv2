import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { TourLauncher } from "@/components/tour/tour";
import { TRANSCRIBE_TOUR } from "@/components/tour/tours";
import { TranscribeTab } from "@/components/tools/tools-client";

export default function AudioToTextPage() {
  return (
    <LivePage>
      <PageHeader
        title="Audio to Text"
        description="Transcribe an upload or a YouTube, Instagram or TikTok link — transcripts are saved forever."
        actions={<TourLauncher tour={TRANSCRIBE_TOUR} />}
      />
      <TranscribeTab />
    </LivePage>
  );
}
