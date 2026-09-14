import { ServerCog } from "lucide-react";
import { ModulePlaceholder } from "@/components/module-placeholder";

export default function AdminInfraPage() {
  return (
    <ModulePlaceholder
      icon={ServerCog}
      title="Infrastructure"
      description="Technical view for dev admins — service health and integrations."
      phase="Grows with each phase"
      features={[
        "Email service status (Instantly)",
        "Lead source health (scrapers, providers)",
        "Voice services (Bland AI)",
        "Domain registrations (Porkbun)",
        "Webhook and API logs",
      ]}
    />
  );
}
