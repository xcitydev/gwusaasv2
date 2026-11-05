"use client";

import Image from "next/image";
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
  { label: "Services", href: "#services" },
  { label: "Your voice", href: "#voice" },
  { label: "Studio", href: "/create" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const hero = document.getElementById("hero");
      if (!hero) return;
      // Collapsed exactly while the hero is fully scrolled out of view.
      setCollapsed(hero.getBoundingClientRect().bottom < 0);
    };
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
          "mx-auto flex max-w-[2200px] items-center justify-between border border-white/5 bg-gradient-to-br from-black/10 to-black/0 px-4 py-3 backdrop-blur-md transition-all duration-300 ease-out motion-reduce:transition-none sm:px-5",
          collapsed && "md:max-w-6xl md:px-3",
        )}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src={BRAND.logo.headerWordmark}
            alt={BRAND.name}
            width={867}
            height={192}
            className="h-6 w-auto sm:h-7"
            priority
          />
        </Link>

        <nav
          className={cn(
            "hidden items-center text-sm text-white/70 transition-all duration-300 motion-reduce:transition-none md:flex",
            collapsed ? "md:gap-5" : "gap-8",
          )}
        >
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="group relative flex h-[36px] items-center transition-colors hover:text-white"
            >
              {link.label}
              <span
                aria-hidden
                className="absolute -bottom-[13px] left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-400 to-transparent opacity-0 shadow-[0_0_10px_2px_rgba(59,130,246,0.5)] transition-all duration-300 group-hover:opacity-100"
              />
            </a>
          ))}
        </nav>

        <div
          className={cn(
            "hidden items-center gap-4 transition-all duration-300 motion-reduce:transition-none md:flex",
            collapsed && "md:gap-3",
          )}
        >
          <Link
            href="/sign-in"
            className="text-sm font-medium text-white/70 transition-colors hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-2 rounded-xl border border-blue-300/30 bg-gradient-to-br from-blue-600 to-blue-700 px-4 py-2 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_4px_0_rgba(20,55,120,0.9),0_8px_18px_rgba(37,99,235,0.3)] transition-[transform,box-shadow,background-color] hover:-translate-y-0.5 hover:from-blue-700 hover:to-blue-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_5px_0_rgba(20,55,120,0.9),0_12px_24px_rgba(37,99,235,0.38)] active:translate-y-1 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.22),0_1px_0_rgba(20,55,120,0.9)]"
          >
            Start free <ArrowRight className="size-3.5" />
          </Link>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Menu"
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/90 transition hover:bg-white/10 md:hidden"
            >
              <Menu className="size-5" />
            </button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[320px] max-w-[88vw] gap-0 overflow-hidden border-white/10 bg-black p-0 data-[side=right]:w-[320px]"
          >
            <div className="relative flex h-full flex-col px-6 pb-6 pt-5">
              <SheetTitle className="flex items-center gap-2.5 font-normal">
                <Image
                  src={BRAND.logo.headerWordmark}
                  alt={BRAND.name}
                  width={867}
                  height={192}
                  className="h-6 w-auto"
                />
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
                    className="group flex items-center justify-between py-4"
                  >
                    <span className="text-xl font-medium tracking-tight">{link.label}</span>
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
