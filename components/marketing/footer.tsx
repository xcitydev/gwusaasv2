import Link from "next/link";
import { BRAND } from "@/lib/brand";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Cold email & outreach", href: "#features" },
      { label: "Find customers", href: "#features" },
      { label: "AI Receptionist", href: "#voice" },
      { label: "IG DMs & AI Voice", href: "#features" },
      { label: "AI Note Taker", href: "#features" },
      { label: "Studio", href: "#studio" },
    ],
  },
  {
    title: "Plans",
    links: [
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
      { label: "Start free", href: "/sign-up" },
      { label: "Sign in", href: "/sign-in" },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Support", href: "/support" },
      { label: "Referrals", href: "/referrals" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto grid w-full max-w-[2200px] gap-10 px-4 py-14 sm:px-6 lg:px-9 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <p className="font-display text-3xl italic">{BRAND.name}</p>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">{BRAND.tagline}</p>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title}>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {column.title}
            </p>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-foreground/80 transition-colors hover:text-primary"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/5">
        <p className="mx-auto max-w-[2200px] px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:px-9">
          © {new Date().getFullYear()} {BRAND.fullName}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
