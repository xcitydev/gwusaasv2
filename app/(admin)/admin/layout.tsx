import { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { AdminGate } from "@/components/admin-gate";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell variant="admin">
      <AdminGate>{children}</AdminGate>
    </AppShell>
  );
}
