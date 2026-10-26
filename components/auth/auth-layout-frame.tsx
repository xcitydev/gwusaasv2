"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AuthBanner, AuthShowcase, AuthSignupBackground } from "@/components/auth/auth-showcase";

export function AuthLayoutFrame({ children }: { children: ReactNode }) {
  const signup = usePathname()?.startsWith("/sign-up") ?? false;

  if (signup) {
    return (
      <div className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-black px-4 py-16 sm:px-6">
        <AuthSignupBackground />
        <Link
          href="/"
          className="absolute left-5 top-5 z-20 inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-black/60 px-4 text-sm text-white/80 backdrop-blur-md transition-colors hover:border-primary/50 hover:text-white sm:left-7 sm:top-7"
        >
          <ArrowLeft className="size-4" /> Back to site
        </Link>
        <main className="relative z-10 my-auto w-full max-w-[432px] rounded-[1.75rem] border border-white/10 bg-black/80 p-6 shadow-[0_24px_90px_-30px_rgba(0,0,0,0.95)] backdrop-blur-xl sm:p-8">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="relative grid min-h-dvh gap-4 bg-background p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(460px,560px)]">
      <AuthShowcase />
      <main className="relative flex flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(420px 260px at 50% 12%, oklch(0.75 0.183 55.934 / 10%), transparent 70%)",
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
