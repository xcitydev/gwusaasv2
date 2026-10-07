import { LivePage } from "@/components/live-page";
import { planGate } from "@/lib/plan-gate";
import { NoteTakerClient } from "@/components/note-taker/note-taker-client";

export default async function NoteTakerPage() {
  const gate = await planGate("/note-taker");
  if (gate) return gate;
  return (
    <LivePage>
      <NoteTakerClient />
    </LivePage>
  );
}
