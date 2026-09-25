import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { TranscribeTab } from "@/components/tools/tools-client";

export default function AudioToTextPage() {
  return (
    <LivePage>
      <PageHeader
        title="Audio to Text"
        description="Transcribe an upload or a YouTube, Instagram or TikTok link — transcripts are saved forever."
      />
      <TranscribeTab />
    </LivePage>
  );
}
