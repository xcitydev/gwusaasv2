import { ReactNode } from "react";
import { AuthBanner, AuthShowcase } from "@/components/auth/auth-showcase";

/**
 * Sign-in / sign-up: the cinematic "Creatily" screen on the left (a short
 * banner on phones), the form on the right.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh gap-4 bg-background p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(460px,560px)]">
      <AuthShowcase />
      <main className="relative flex flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(420px 260px at 50% 12%, oklch(0.598 0.241 294.3 / 10%), transparent 70%)",
          }}
        />
        <AuthBanner />
        <div className="relative mx-auto flex w-full max-w-[432px] flex-1 flex-col justify-center gap-5 px-1 py-6 sm:gap-6 sm:py-12 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
