"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The hero CTA pair (References/button.html): sharp-cornered button with a
 * glow at its base and a conic border beam that appears on hover.
 * Both variants use the brand-orange beam; the second variant also carries
 * the stronger orange accent treatment.
 */
export function BeamButton({
  variant = "white",
  href,
  onClick,
  className,
  disabled = false,
  title,
  children,
}: {
  variant?: "white" | "orange";
  /** Renders a next/link when set; otherwise a plain button. */
  href?: string;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const outer = cn(
    "group relative inline-flex h-[50px] items-center justify-center overflow-hidden rounded-none bg-white/5 outline-none transition-transform active:scale-95 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100",
    className,
  );
  const label = (
    <span className="relative z-20 flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-wide text-white">
      {children}
    </span>
  );

  if (variant === "orange") {
    const inner = (
      <>
        {/* Accent beam + glow (reference button 2) */}
        <span
          aria-hidden
          className="absolute inset-[-100%] animate-[spin_3s_linear_infinite] bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,transparent_75%,#fb923c_100%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
        <span
          aria-hidden
          className="absolute inset-0 bg-zinc-800 transition-opacity duration-300 group-hover:opacity-0"
        />
        <span aria-hidden className="absolute inset-[1px] z-10 bg-black" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background:
              "radial-gradient(50% 50% at 50% 100%, rgba(251,146,60,0.2) 0%, transparent 100%)",
          }}
        />
        {label}
      </>
    );
    return href ? (
      <Link href={href} className={outer}>
        {inner}
      </Link>
    ) : (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={cn(outer, "cursor-pointer")}
      >
        {inner}
      </button>
    );
  }

  const inner = (
    <>
      {/* Glow layers */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-100 transition-opacity duration-[1200ms] ease-in-out group-hover:opacity-0"
        style={{
          background:
              "radial-gradient(15% 50% at 50% 100%, rgb(251,146,60) 0%, rgba(251,146,60,0) 100%)",
          filter: "blur(15px)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[1200ms] ease-in-out group-hover:opacity-100"
        style={{
          background:
              "radial-gradient(60.6% 50% at 50% 100%, rgb(251,146,60) 0%, rgba(251,146,60,0) 100%)",
          filter: "blur(18px)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-100 transition-opacity duration-[1200ms] ease-in-out group-hover:opacity-0"
        style={{
          background:
              "radial-gradient(10.7% 50% at 50% 100%, rgb(251,146,60) 0%, rgba(251,146,60,0) 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[1200ms] ease-in-out group-hover:opacity-100"
        style={{
          background:
              "radial-gradient(60.1% 50% at 50% 100%, rgb(251,146,60) 0%, rgba(251,146,60,0) 100%)",
        }}
      />
      {/* Border beam */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-none"
      >
        <div
          className="absolute -inset-[300%] animate-[spin_4s_linear_infinite]"
          style={{
            background:
              "conic-gradient(from 90deg at 50% 50%, transparent 0%, transparent 90%, #fb923c 100%)",
          }}
        />
      </div>
      <div aria-hidden className="absolute inset-[1px] bg-black" />
      {label}
    </>
  );
  return href ? (
    <Link href={href} className={outer}>
      {inner}
    </Link>
  ) : (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(outer, "cursor-pointer")}
    >
      {inner}
    </button>
  );
}
