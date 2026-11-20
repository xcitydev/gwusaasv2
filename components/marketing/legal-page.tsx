import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { LEGAL, LEGAL_LINKS, LEGAL_UPDATED } from "@/lib/legal";
import { SiteFooter } from "./footer";

/**
 * Shell + typography for the public legal pages (/privacy, /terms,
 * /acceptable-use, /opt-out). Server-rendered and static; the copy lives in
 * each page, the company facts in lib/legal.ts.
 */
export function LegalShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-black text-foreground">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center">
            <Image
              src={BRAND.logo.headerWordmark}
              alt={BRAND.name}
              width={867}
              height={192}
              className="h-7 w-auto"
            />
          </Link>
          <nav className="flex gap-4 text-sm text-white/60">
            <Link href={LEGAL_LINKS.terms} className="hover:text-white">Terms</Link>
            <Link href={LEGAL_LINKS.privacy} className="hover:text-white">Privacy</Link>
            <Link href={LEGAL_LINKS.acceptableUse} className="hidden hover:text-white sm:inline">
              Acceptable use
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">{children}</main>
      <SiteFooter />
    </div>
  );
}

/** Page title + "last updated" line + optional intro. */
export function LegalHeader({ title, intro }: { title: string; intro?: ReactNode }) {
  return (
    <div className="mb-10 border-b border-white/10 pb-8">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {LEGAL_UPDATED}</p>
      {intro && <div className="mt-5 space-y-3 text-[15px] leading-relaxed text-white/75">{intro}</div>}
    </div>
  );
}

/** A numbered/anchored section. `id` makes deep links like /terms#credits work. */
export function LegalSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 py-5">
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-white">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-white/75 [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_strong]:text-white">
        {children}
      </div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-white/30">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** Mail link for one of the LEGAL emails (placeholders render as-is). */
export function Mail({ to }: { to: string }) {
  return <a href={`mailto:${to}`}>{to}</a>;
}

/** The "who we are / how to reach us" block every policy ends with. */
export function ContactBlock() {
  return (
    <p>
      {LEGAL.companyName} (operating {LEGAL.productName})
      <br />
      {LEGAL.postalAddress}
      <br />
      Email: <Mail to={LEGAL.contactEmail} />
    </p>
  );
}
