"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextAnimate } from "@/components/ui/text-animate";
import { cn } from "@/lib/utils";
import { SERVICES, ServiceRail } from "./services";
import { BeamButton } from "./beam-button";
import { Background } from "./background";
import { Counter, EASE, Eyebrow, Marquee } from "./primitives";

/**
 * Hero (References/hero.html): glass eyebrow badge, per-word gradient
 * headline, paired beam-effect CTAs, then the services sliding in a
 * dimmed-logo marquee with the reference's grayscale-to-color hover.
 */

const HEADLINE_WORDS: { text: string; bright?: boolean }[] = [
  { text: "Your" },
  { text: "Entire" },
  { text: "Growth" },
  { text: "Team." },
  { text: "One" },
  { text: "AI" },
  { text: "Platform.", bright: true },
];

/** Entrance mirroring the reference's staggered fade-slide-in. */
function Enter({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 30, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 1, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  const seeMore = () =>
    document.getElementById("showcase")?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });

  return (
    <section
      id="hero"
      className="relative flex flex-col items-center overflow-hidden pb-16 pt-32 sm:pt-40"
    >
      {/* Top aurora band (References/gold-bg.html UnicornStudio layer). */}
      <Background />

      {/* Falling-beam grid backdrop (References/gold-bg.html) — fixed behind
          the page, running edge to edge with no cut. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
      >
        <div className="absolute inset-x-0 top-0 mx-auto flex h-full w-full max-w-[80rem] justify-between border-x border-white/5 px-4 sm:px-6">
          <div className="relative h-full w-px overflow-hidden bg-white/5">
            <div
              className="absolute inset-x-0 top-0 h-[200px] animate-border-beam bg-gradient-to-b from-transparent via-orange-500/40 to-transparent"
              style={{ animationDuration: "5s" }}
            />
          </div>
          <div className="relative hidden h-full w-px overflow-hidden bg-white/5 md:block">
            <div
              className="absolute inset-x-0 top-0 h-[200px] animate-border-beam bg-gradient-to-b from-transparent via-orange-500/40 to-transparent"
              style={{ animationDuration: "7s", animationDelay: "2s" }}
            />
          </div>
          <div className="relative hidden h-full w-px overflow-hidden bg-white/5 lg:block">
            <div
              className="absolute inset-x-0 top-0 h-[200px] animate-border-beam bg-gradient-to-b from-transparent via-orange-500/40 to-transparent"
              style={{ animationDuration: "5s", animationDelay: "4s" }}
            />
          </div>
          <div className="relative h-full w-px overflow-hidden bg-white/5">
            <div
              className="absolute inset-x-0 top-0 h-[200px] animate-border-beam bg-gradient-to-b from-transparent via-orange-500/40 to-transparent"
              style={{ animationDuration: "8s", animationDelay: "1s" }}
            />
          </div>
        </div>
      </div>

      <div className="relative z-10 max-w-5xl px-6 text-center">
        <Enter delay={0.1} className="flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-white/20 via-white/0 to-white/10 px-3 py-1.5 text-xs font-medium tracking-wide text-orange-100/80 backdrop-blur-sm">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.5)]" />
            </span>
            YOUR AI GROWTH TEAM
          </span>
        </Enter>

        {/* Headline: Magic UI TextAnimate blurInUp per character, sequenced
            word by word. The vertical gradient lives on each animated
            segment (per-character gradient reads identically for a
            top-to-bottom fade), the wrapper keeps the per-word brightness. */}
        <h1 className="mt-8 flex flex-wrap justify-center gap-x-[0.25em] gap-y-2 text-6xl font-medium leading-[1.1] tracking-tighter md:text-8xl">
          {HEADLINE_WORDS.map((word, i) => (
            <span
              key={word.text}
              className={cn(
                "leading-[1.3]",
                word.bright ? "opacity-100" : "opacity-60",
              )}
            >
              {reduce ? (
                <span className="bg-gradient-to-b from-white via-white to-white/50 bg-clip-text text-transparent">
                  {word.text}
                </span>
              ) : (
                <TextAnimate
                  as="span"
                  animation="blurInUp"
                  by="character"
                  once
                  delay={0.2 + i * 0.1}
                  duration={0.5}
                  segmentClassName="bg-gradient-to-b from-white via-white to-white/50 bg-clip-text text-transparent"
                >
                  {word.text}
                </TextAnimate>
              )}
            </span>
          ))}
        </h1>

        {/* Supporting text: subtle blur-in by word, after the headline lands. */}
        {reduce ? (
          <p className="mx-auto mt-6 max-w-3xl text-pretty text-xl font-medium leading-relaxed text-muted-foreground md:text-2xl">
            Find leads, automate outreach, answer calls, manage DMs, and create
            content with 20+ AI models, all from one workspace.
          </p>
        ) : (
          <TextAnimate
            as="p"
            animation="blurIn"
            by="word"
            once
            delay={0.9}
            duration={0.6}
            className="mx-auto mt-6 block max-w-3xl text-pretty text-xl font-medium leading-relaxed text-muted-foreground md:text-2xl"
          >
            Find leads, automate outreach, answer calls, manage DMs, and create
            content with 20+ AI models, all from one workspace.
          </TextAnimate>
        )}

        <Enter
          delay={1.2}
          className="mt-10 flex flex-col items-center justify-center gap-6 md:flex-row"
        >
          <BeamButton href="/sign-up" className="min-w-[180px]">
            Try now
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </BeamButton>

          <BeamButton variant="orange" onClick={seeMore} className="min-w-[180px]">
            See more
            <ChevronDown className="size-3.5 transition-transform duration-300 group-hover:translate-y-0.5" />
          </BeamButton>
        </Enter>
      </div>

      {/* Services marquee — the reference's dimmed logo wall, holding our services */}
      <div className="relative z-10 mt-20 w-full max-w-6xl px-6">
        <Enter delay={1.35}>
          <p className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            10+ AI services · one login
          </p>
        </Enter>
        <Enter delay={1.45}>
          <Marquee
            duration={38}
            className="mt-8 opacity-40 grayscale transition-all duration-700 hover:opacity-100 hover:grayscale-0"
          >
            {SERVICES.map((service) => (
              <div key={service.id} className="mx-8 flex items-center gap-2.5">
                <service.icon className="size-5 text-white/90" aria-hidden />
                <span className="whitespace-nowrap text-lg font-medium text-white">
                  {service.name}
                </span>
              </div>
            ))}
          </Marquee>
        </Enter>
      </div>

      {/* "Your growth team" — the full service card rail */}
      <div className="relative z-10 w-full px-4 sm:px-6 lg:px-9">
        <ServiceRail />
      </div>
    </section>
  );
}

const HEADLINE = ["Your", "whole", "growth", "team,"];

const STATS: { value: number; suffix: string; label: string }[] = [
  { value: 10, suffix: "+", label: "AI modules, one workspace" },
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
              "radial-gradient(900px 480px at 50% 30%, oklch(0.75 0.183 55.934 / 0.14), transparent 70%)",
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
              className="block bg-gradient-to-b from-orange-300 to-orange-500 bg-clip-text text-transparent"
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
            <BeamButton href="/sign-up" className="min-w-[180px]">
              Start free
              <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
            </BeamButton>
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
