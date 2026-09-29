"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, ArrowUpRight, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

const LINKS = [
  { label: "What's inside", href: "#features" },
  { label: "Your voice", href: "#voice" },
  { label: "Studio", href: "#studio" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-0 z-50 px-4 pt-3 sm:px-6 lg:px-9"
    >
      <div
        className={cn(
          "mx-auto flex h-14 max-w-[2200px] items-center justify-between rounded-full border px-4 transition-all duration-300 sm:px-5",
          scrolled
            ? "border-white/10 bg-background/70 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.8)] backdrop-blur-xl"
            : "border-transparent bg-transparent",
        )}
      >
        <Link href="/" className="flex items-center gap-2">
          <span className="font-display text-2xl italic tracking-wide">{BRAND.name}</span>
          <span className="hidden text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground sm:inline">
            Grow With Us
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm" className="rounded-full">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm" className="rounded-full px-4">
            <Link href="/sign-up">
              Start free <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[320px] max-w-[88vw] gap-0 overflow-hidden border-white/10 bg-[#0b0a08] p-0 data-[side=right]:w-[320px]"
          >
            {/* Gold glow backdrop */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(320px 220px at 85% 0%, oklch(0.86 0.17 93 / 0.14), transparent 70%), radial-gradient(360px 260px at 50% 110%, oklch(0.86 0.17 93 / 0.1), transparent 70%)",
              }}
            />
            <div className="relative flex h-full flex-col px-6 pb-6 pt-5">
              <SheetTitle className="flex items-baseline gap-2.5 font-display text-2xl font-normal italic">
                {BRAND.name}
                <span className="font-sans text-[9px] font-medium uppercase not-italic tracking-[0.22em] text-muted-foreground">
                  Grow With Us
                </span>
              </SheetTitle>
              <nav className="mt-8 flex flex-col">
                {LINKS.map((link, i) => (
                  <motion.a
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.45, delay: 0.08 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                    className="group flex items-center justify-between border-b border-white/[0.07] py-4"
                  >
                    <span className="flex items-baseline gap-3.5">
                      <span className="font-display text-sm italic text-primary/70">
                        0{i + 1}
                      </span>
                      <span className="text-xl font-medium tracking-tight">{link.label}</span>
                    </span>
                    <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
                  </motion.a>
                ))}
              </nav>
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.42, ease: [0.22, 1, 0.36, 1] }}
                className="mt-auto flex flex-col gap-2.5"
              >
                <Button asChild size="lg" className="h-12 rounded-full text-base font-semibold">
                  <Link href="/sign-up">
                    Start free <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-full text-base">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <p className="mt-3 whitespace-nowrap text-center text-[8px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Your whole growth team · run by AI
                </p>
              </motion.div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </motion.header>
  );
}
