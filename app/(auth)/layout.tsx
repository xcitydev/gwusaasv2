import type { ReactNode } from "react";
import { AuthLayoutFrame } from "@/components/auth/auth-layout-frame";

/**
 * Sign-in / sign-up: the cinematic "Creatily" screen on the left (a short
 * banner on phones), the form on the right.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthLayoutFrame>{children}</AuthLayoutFrame>;
}
