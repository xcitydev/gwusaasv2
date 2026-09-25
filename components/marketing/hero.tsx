"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Counter, EASE, Eyebrow, Item, Stagger, TileVideo, WIDE } from "./primitives";
import { STUDIO_TILES } from "./sections";

/**
 * The hero is a screen: a bezel-framed, full-bleed video with one giant
 * chrome title, one pill, one button — then an "Explore models" strip.
 */
export function Hero() {
  return (
    <section className="relative pt-24 sm:pt-28">
      <div className={WIDE}>
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1, ease: EASE }}
          className="relative rounded-[2rem] bg-[#0a0a0a] p-2.5 sm:rounded-[2.75rem] sm:p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07),inset_0_2px_12px_rgba(255,255,255,0.05),0_50px_140px_-40px_rgba(0,0,0,0.95)]"
        >
          {/* Bezel sheen */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[2rem] sm:rounded-[2.75rem] bg-[radial-gradient(110%_70%_at_50%_-10%,rgba(255,255,255,0.08),transparent_60%)]"
          />
          <div className="relative aspect-[16/10] overflow-hidden rounded-[1.4rem] bg-black sm:aspect-[2.3/1] sm:rounded-[2rem]">
            <video
              className="absolute inset-0 h-full w-full object-cover"
              src="/hero.mp4"
              poster="/hero-poster.jpg"
              autoPlay
              muted
              loop
              playsInline
            />
            {/* Vignette + floor for legibility */}
            <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_35%,transparent_30%,rgba(0,0,0,0.6))]" />
            <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/75 to-transparent" />

            {/* Corner badge */}
            <motion.span
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.8, ease: EASE }}
              className="absolute right-4 top-4 rounded-md bg-primary px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-primary-foreground shadow-[0_0_30px_-6px_oklch(0.86_0.17_93/0.9)] sm:right-6 sm:top-6 sm:text-xs"
            >
              New
            </motion.span>

            {/* Title stack */}
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <motion.h1
                initial={{ opacity: 0, y: 30, scale: 0.94, filter: "blur(10px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                transition={{ duration: 1.1, delay: 0.25, ease: EASE }}
                className="font-black uppercase leading-[0.9] tracking-[-0.04em] drop-shadow-[0_18px_40px_rgba(0,0,0,0.7)]"
                style={{ fontSize: "clamp(2.6rem, 9.5vw, 8.5rem)" }}
              >
                <span className="bg-gradient-to-b from-[#fff4c2] via-primary to-[#8a6905] bg-clip-text text-transparent">
                  Grow With Us
                </span>
              </motion.h1>
              <motion.span
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.7, ease: EASE }}
                className="mt-4 rounded-full border border-white/25 bg-black/35 px-5 py-2 text-xs font-medium uppercase tracking-[0.2em] text-white/90 backdrop-blur-md sm:mt-5 sm:text-sm"
              >
                Your whole growth team · run by AI
              </motion.span>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.9, ease: EASE }}
                className="mt-8 sm:mt-10"
              >
                <Button
                  asChild
                  size="lg"
                  className="h-13 rounded-xl px-10 text-lg font-bold shadow-[0_0_50px_-8px_oklch(0.86_0.17_93/0.8)] transition-transform hover:scale-[1.03]"
                >
                  <Link href="/sign-up">Try now</Link>
                </Button>
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* Explore models */}
        <div id="studio" className="scroll-mt-28">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.1, ease: EASE }}
            className="mt-8 flex items-end justify-between gap-4 sm:mt-10"
          >
            <div>
              <h2 className="text-lg font-black uppercase tracking-tight sm:text-xl">
                Explore models
              </h2>
              <p className="text-sm text-muted-foreground">
                Video &amp; image models plus AI editing tools — one credit balance
              </p>
            </div>
            <Link
              href="/sign-up"
              className="flex shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary"
            >
              All tools <ChevronRight className="size-4" />
            </Link>
          </motion.div>

          <Stagger className="mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 scrollbar-none sm:gap-4">
            {STUDIO_TILES.map((tile) => (
              <Item key={tile.name} className="w-[190px] shrink-0 snap-start sm:w-[220px]">
                <motion.article
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className="group overflow-hidden rounded-2xl border border-white/10 bg-card"
                >
                  <div className={cn("relative aspect-[4/5] bg-gradient-to-br transition-transform duration-700 group-hover:scale-105", tile.art)}>
                    <TileVideo src={tile.video} poster={tile.poster} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/20" />
                    <span className="absolute left-3 top-3 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
                      {tile.tag}
                    </span>
                    <span className="absolute bottom-3 right-3 flex size-8 items-center justify-center rounded-full bg-white/15 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                      <Play className="size-3.5" />
                    </span>
                  </div>
                  <p className="truncate px-4 py-3 text-sm font-medium">{tile.name}</p>
                </motion.article>
              </Item>
            ))}
          </Stagger>
        </div>
      </div>
    </section>
  );
}

const HEADLINE = ["Your", "whole", "growth", "team,"];

const STATS: { value: number; suffix: string; label: string }[] = [
  { value: 9, suffix: "", label: "AI modules, one workspace" },
  { value: 20, suffix: "+", label: "image & video models" },
  { value: 24, suffix: "/7", label: "calls answered in your voice" },
  { value: 15, suffix: "s", label: "to clone your voice" },
];

/** The pitch, right after the screen: headline, lede, CTAs, numbers. */
export function Statement() {
  return (
    <section className="relative py-20 sm:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(900px 480px at 50% 30%, oklch(0.86 0.17 93 / 0.14), transparent 70%)",
          }}
        />
      </div>
      <div className="mx-auto max-w-4xl px-5 text-center sm:px-8">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
        >
          <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}>
            <Eyebrow>
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              New · AI Note Taker & Higgsfield Studio
            </Eyebrow>
          </motion.div>
          <h2 className="mt-6 text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-6xl">
            <span className="block">
              {HEADLINE.map((word) => (
                <span key={word}>
                  <motion.span
                    className="inline-block"
                    variants={{
                      hidden: { opacity: 0, y: 24, filter: "blur(8px)" },
                      show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.8, ease: EASE } },
                    }}
                  >
                    {word}
                  </motion.span>{" "}
                </span>
              ))}
            </span>
            <motion.span
              className="block font-display font-normal italic text-primary"
              variants={{
                hidden: { opacity: 0, y: 24, filter: "blur(8px)" },
                show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.9, ease: EASE } },
              }}
            >
              run by AI.
            </motion.span>
          </h2>
          <motion.p
            variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } } }}
            className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl"
          >
            Cold email that books, leads found for you, a receptionist that
            answers in your own cloned voice, Instagram DMs on autopilot,
            meeting notes written while you talk — and a full creative studio.
            One workspace, one balance.
          </motion.p>
          <motion.div
            variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } } }}
            className="mt-8 flex flex-wrap items-center justify-center gap-3"
          >
            <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
              <Link href="/sign-up">
                Start free <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-6 text-base">
              <Link href="#features">See what&apos;s inside</Link>
            </Button>
          </motion.div>
          <motion.dl
            variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.8 } } }}
            className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4"
          >
            {STATS.map((s) => (
              <div key={s.label}>
                <dt className="text-3xl font-semibold tracking-tight">
                  <Counter to={s.value} suffix={s.suffix} />
                </dt>
                <dd className="mt-1 text-xs text-muted-foreground">{s.label}</dd>
              </div>
            ))}
          </motion.dl>
        </motion.div>
      </div>
    </section>
  );
}
