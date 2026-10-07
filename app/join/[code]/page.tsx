import type { Metadata } from "next";
import { JoinInvite } from "@/components/forms/join-invite";

export const metadata: Metadata = {
  title: "You're invited",
  robots: { index: false, follow: false },
};

/** Public landing for an admin-shared forms invite link: /join/GWU-XXXX-XXXX. */
export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  const { code } = await params;
  return <JoinInvite code={decodeURIComponent(code)} />;
}
