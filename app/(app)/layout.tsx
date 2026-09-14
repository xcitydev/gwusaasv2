import { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { EnsureUser } from "@/components/ensure-user";
import { AiSupportWidget } from "@/components/support/ai-widget";
import { isConfigured } from "@/lib/runtime";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell variant="app">
      {isConfigured && <EnsureUser />}
      {children}
      <AiSupportWidget />
    </AppShell>
  );
}
