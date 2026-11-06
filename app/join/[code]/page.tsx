import type { Metadata } from "next";
import { JoinInvite } from "@/components/forms/join-invite";

export const metadata: Metadata = {
  title: "You're invited",
  robots: { index: false, follow: false },
};

/** Public landing for an admin-shared forms invite link: /join/GWU-XXXX-XXXX. */
export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  const { code } = await params;
  // A malformed %-escape must not crash the page — fall back to the raw segment.
  let decoded = code;
  try {
    decoded = decodeURIComponent(code);
  } catch {
    // keep the raw value; redeem rejects it with a friendly message
  }
  return <JoinInvite code={decoded} />;
}
