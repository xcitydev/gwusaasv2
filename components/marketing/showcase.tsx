"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Marquee, Reveal, WIDE } from "./primitives";

/**
 * Model announcements, Ausar-style: eyebrow, giant title, one CTA on the
 * left; the eight images sliding in an endless marquee on the right.
 * Images live in public/showcase/<id>-<1..8>.jpg (rendered with Soul 2
 * through our own Studio pipeline).
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
    <section id="showcase" className="relative scroll-mt-24 pt-14 sm:pt-20">
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
      <article
        className={cn(
          // minmax(0, …) on every track: without it the marquee's
          // unshrinkable content blows the column out (right overflow on
          // mobile, over the text on desktop).
          "grid grid-cols-[minmax(0,1fr)] items-center gap-8 rounded-[2rem] border border-white/10 bg-[#0b0b0d] p-5 sm:p-8 lg:gap-12 lg:p-12",
          flip
            ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]"
            : "lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]",
        )}
      >
        <div className={cn(flip && "lg:order-2")}>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/80">
            {eyebrow}
          </p>
          <h2 className="mt-3 text-balance text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-5xl xl:text-6xl">
            <span className="bg-gradient-to-b from-white via-white to-white/50 bg-clip-text text-transparent">
              {title}
            </span>
          </h2>
          <p className="mt-4 max-w-sm text-pretty text-base text-muted-foreground sm:text-lg">
            {blurb}
          </p>
          <Link
            href="/sign-up"
            className="mt-7 inline-flex h-12 w-full max-w-sm items-center justify-center gap-2 bg-gradient-to-br from-orange-400 to-orange-600 px-6 text-sm font-medium text-white shadow-[0_0_20px_rgba(255,140,0,0.4)] transition hover:from-orange-500 hover:to-yellow-400"
          >
            {cta} <ArrowRight className="size-3.5" />
          </Link>
          <Link
            href="#pricing"
            className="mt-4 block text-sm font-medium text-white/80 transition-colors hover:text-primary"
          >
            See plans &amp; credits
          </Link>
        </div>

        {/* Sliding-images marquee (References/sliding-images.html): two
           rows of the eight visuals looping endlessly with an edge fade,
           filling exactly the image column; hover pauses. */}
        <div className="relative space-y-3 sm:space-y-4">
          {/* Two images repeated per row so the loop stays wider than the
              column even on ultra-wide screens. */}
          <Marquee duration={36} reverse={flip}>
            {[...images.slice(0, 4), images[0], images[1]].map((src, i) => (
              <MarqueeImage key={`${i}-${src}`} src={src} />
            ))}
          </Marquee>
          <Marquee duration={44} reverse={!flip}>
            {[...images.slice(4), images[4], images[5]].map((src, i) => (
              <MarqueeImage key={`${i}-${src}`} src={src} />
            ))}
          </Marquee>
          <Link
            href="/sign-up"
            className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-black/70 px-4 py-2.5 text-sm font-medium text-white shadow-2xl backdrop-blur transition-colors hover:bg-black/90 hover:text-primary"
          >
            {studio} <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </article>
    </Reveal>
  );
}

/** One sliding visual — sized to fill the image column comfortably. */
function MarqueeImage({ src }: { src: string }) {
  return (
    <div className="group relative h-28 w-44 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 sm:h-40 sm:w-64 lg:h-48 lg:w-72">
      <Image
        src={src}
        alt=""
        fill
        sizes="(min-width: 640px) 288px, 208px"
        className="object-cover transition-transform duration-700 group-hover:scale-105"
      />
    </div>
  );
}
