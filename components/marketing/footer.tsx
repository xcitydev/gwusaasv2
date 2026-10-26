import Image from "next/image";
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
      { label: "Studio", href: "/create" },
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

/**
 * Glass-card footer: the whole footer lives in one frosted panel with a
 * gradient sheen — brand block left, link columns right, copyright bar
 * across the card floor.
 */
export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-white/10 bg-black">
      <div className="mx-auto w-full max-w-[2200px] px-4 py-12 sm:px-6 lg:px-9">
        <div className="relative overflow-hidden rounded-3xl bg-white/5 shadow-[0_25px_50px_rgba(0,0,0,0.2)] ring-1 ring-white/10 backdrop-blur-[10px] backdrop-saturate-[1.25]">
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-white/10"
          />

          <div className="relative px-6 py-12 sm:px-10 sm:py-16 lg:px-14">
            <div className="flex flex-col items-start justify-between gap-10 lg:flex-row">
              {/* Brand */}
              <div className="max-w-md">
                <Image
                  src={BRAND.logo.footerWordmarkFull}
                  alt={`${BRAND.name} by Grow With Us Agency`}
                  width={867}
                  height={246}
                  className="-ml-1.5 h-14 w-auto"
                />
                <p className="mt-4 text-sm leading-relaxed text-white/70">
                  Cold email that books, leads found for you, a receptionist
                  that answers in your own cloned voice, Instagram DMs on
                  autopilot, meeting notes written while you talk — and a full
                  creative studio. One workspace, one balance.
                </p>
              </div>

              {/* Navigation */}
              <div className="grid w-full grid-cols-2 gap-8 sm:grid-cols-3 lg:w-auto">
                {COLUMNS.map((column) => (
                  <div key={column.title}>
                    <p className="text-sm font-medium tracking-tight text-white/90">
                      {column.title}
                    </p>
                    <ul className="mt-3 space-y-2 text-sm text-white/60">
                      {column.links.map((link) => (
                        <li key={link.label}>
                          <Link
                            href={link.href}
                            className="transition hover:text-white"
                          >
                            {link.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            {/* Copyright bar */}
            <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row">
              <p className="text-xs text-white/50">
                © {new Date().getFullYear()} {BRAND.fullName}. All rights
                reserved.
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
