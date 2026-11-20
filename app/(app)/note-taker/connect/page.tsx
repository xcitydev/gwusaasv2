import { LivePage } from "@/components/live-page";
import { CalendarConnectConfirm } from "@/components/note-taker/calendar-connect-confirm";

/**
 * Landing after Google / Outlook consent. The calendar is attached only when
 * the signed-in user confirms here and is the one who started the flow.
 */
export default async function NoteTakerConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ nonce?: string | string[] }>;
}) {
  const { nonce } = await searchParams;
  return (
    <LivePage>
      <CalendarConnectConfirm nonce={typeof nonce === "string" ? nonce : ""} />
    </LivePage>
  );
}
