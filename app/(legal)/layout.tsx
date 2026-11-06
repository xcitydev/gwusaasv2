import type { ReactNode } from "react";
import { LegalShell } from "@/components/marketing/legal-page";

/** Public legal pages: no sign-in (listed in proxy.ts isPublicRoute). */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return <LegalShell>{children}</LegalShell>;
}
