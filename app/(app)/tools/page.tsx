import { redirect } from "next/navigation";

// The tools each have their own route now; old links and bookmarks land on
// the first one. Legacy ?tab= deep links map to their new homes.
export default async function ToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  if (tab === "carousel") redirect("/carousels");
  if (tab === "transcribe") redirect("/audio-to-text");
  redirect("/get-found");
}
