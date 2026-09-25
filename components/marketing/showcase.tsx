"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Item, Reveal, Stagger, WIDE } from "./primitives";

/**
 * Model announcements, Ausar-style: eyebrow, giant title, one CTA on the
 * left; an eight-image grid with a floating "open studio" button on the
 * right. Images live in public/showcase/<id>-<1..8>.jpg (rendered with
 * Soul 2 through our own Studio pipeline).
 */
type Showcase = {
  id: string;
  eyebrow: string;
  title: string;
  blurb: string;
  cta: string;
  studio: string;
};

const SHOWCASES: Showcase[] = [
  {
    id: "soul",
    eyebrow: "Exclusively in Studio",
    title: "Soul 2 in Studio",
    blurb:
      "The Higgsfield photoreal image model, inside your workspace. Fashion, editorial and product shots that read like a real shoot, priced per image.",
    cta: "Try Soul 2",
    studio: "Open image studio",
  },
  {
    id: "motion",
    eyebrow: "New in Studio",
    title: "Your character. Any move.",
    blurb:
      "Upload one photo and a driving video. Kling 3.0 Motion Control transfers the performance onto your character, frame for frame.",
    cta: "Try Motion Control",
    studio: "Open video studio",
  },
  {
    id: "cinema",
    eyebrow: "Now in Studio",
    title: "Cinema Studio 4.0",
    blurb:
      "Direct the shot: genre, era, camera move, lens, light and palette. Up to 30 seconds, with sound.",
    cta: "Try Cinema Studio",
    studio: "Open video studio",
  },
];

export function Showcases() {
  return (
    <section id="showcase" className="relative pt-14 sm:pt-20">
      <div className={cn(WIDE, "space-y-5 sm:space-y-8")}>
        {SHOWCASES.map((showcase, i) => (
          <ShowcaseBlock key={showcase.id} {...showcase} flip={i % 2 === 1} />
        ))}
      </div>
    </section>
  );
}

function ShowcaseBlock({
  id,
  eyebrow,
  title,
  blurb,
  cta,
  studio,
  flip,
}: Showcase & { flip: boolean }) {
  const images = Array.from({ length: 8 }, (_, i) => `/showcase/${id}-${i + 1}.jpg`);
  return (
    <Reveal>
      <article className="grid items-center gap-8 rounded-[2rem] border border-white/10 bg-[#0b0b0d] p-5 sm:p-8 lg:grid-cols-[minmax(0,24rem)_1fr] lg:gap-12 lg:p-12">
        <div className={cn(flip && "lg:order-2")}>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/80">
            {eyebrow}
          </p>
          <h2 className="mt-3 text-balance text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-5xl xl:text-6xl">
            <span className="bg-gradient-to-b from-[#fff4c2] via-primary to-[#8a6905] bg-clip-text text-transparent">
              {title}
            </span>
          </h2>
          <p className="mt-4 max-w-sm text-pretty text-base text-muted-foreground sm:text-lg">
            {blurb}
          </p>
          <Button
            asChild
            size="lg"
            className="mt-7 h-12 w-full max-w-sm rounded-xl text-base font-semibold"
          >
            <Link href="/sign-up">{cta}</Link>
          </Button>
          <Link
            href="#pricing"
            className="mt-4 block text-sm font-medium text-white/80 transition-colors hover:text-primary"
          >
            See plans &amp; credits
          </Link>
        </div>

        <div className="relative">
          <Stagger className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {images.map((src) => (
              <Item
                key={src}
                className="group relative aspect-[16/10] overflow-hidden rounded-xl bg-white/5"
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 22vw, 45vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
              </Item>
            ))}
          </Stagger>
          <Link
            href="/sign-up"
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-black/70 px-4 py-2.5 text-sm font-medium text-white shadow-2xl backdrop-blur transition-colors hover:bg-black/90 hover:text-primary"
          >
            {studio} <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </article>
    </Reveal>
  );
}
