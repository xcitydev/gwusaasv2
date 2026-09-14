import { ReactNode } from "react";
import { BRAND } from "@/lib/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* Gold glow backdrop, echoing the agency landing page */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(600px 300px at 50% 0%, oklch(0.86 0.17 93 / 10%), transparent 70%)",
        }}
      />
      <div className="relative z-10 mb-8 text-center">
        <h1 className="font-display text-4xl italic tracking-wide">
          {BRAND.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{BRAND.tagline}</p>
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
