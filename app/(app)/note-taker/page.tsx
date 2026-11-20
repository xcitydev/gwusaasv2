import { LivePage } from "@/components/live-page";
import { planGate } from "@/lib/plan-gate";
import { NoteTakerClient } from "@/components/note-taker/note-taker-client";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NoteTakerPage({
  searchParams,
}: {
  searchParams: Promise<{
    meeting?: string | string[];
    t?: string | string[];
    tab?: string | string[];
    connect?: string | string[];
  }>;
}) {
  const gate = await planGate("/note-taker");
  if (gate) return gate;
  const params = await searchParams;
  const at = Number(first(params.t));
  return (
    <LivePage>
      <NoteTakerClient
        initialMeeting={first(params.meeting) ?? null}
        initialAt={Number.isFinite(at) && at >= 0 ? at : null}
        initialTab={first(params.tab) ?? null}
        highlightConnect={first(params.connect) === "1"}
      />
    </LivePage>
  );
}
