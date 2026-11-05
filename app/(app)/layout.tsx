import { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { EnsureUser } from "@/components/ensure-user";
import { AiSupportWidget } from "@/components/support/ai-widget";
import { isConfigured } from "@/lib/runtime";
import { TermsGate } from "@/components/auth/terms-gate";
import { LockedNotice } from "@/components/auth/locked-notice";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell variant="app">
      {isConfigured && <EnsureUser />}
      {isConfigured && <TermsGate />}
      {isConfigured && <LockedNotice />}
      {children}
      <AiSupportWidget />
    </AppShell>
  );
}
