import { notFound } from "next/navigation";
import { getFormDef } from "@/lib/forms-def";
import { ServiceForm } from "@/components/forms/service-form";
import { LivePage } from "@/components/live-page";

export default async function FormPage({
  params,
}: PageProps<"/forms/[slug]">) {
  const { slug } = await params;
  const def = getFormDef(slug);
  if (!def) notFound();
  return (
    <LivePage>
      <ServiceForm def={def} />
    </LivePage>
  );
}
