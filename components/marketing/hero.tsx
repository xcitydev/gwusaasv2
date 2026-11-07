"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { TextAnimate } from "@/components/ui/text-animate";
import { cn } from "@/lib/utils";
import { SERVICES, ServiceRail } from "./services";
import { AnimatedGenerateButton } from "./animated-generate-button";
import { BeamButton } from "./beam-button";
import { EASE, Marquee } from "./primitives";

/**
 * Hero (References/hero.html): glass eyebrow badge, per-word gradient
 * headline, paired beam-effect CTAs, then the services sliding in a
 * dimmed-logo marquee with the reference's grayscale-to-color hover.
 */

const HEADLINE_WORDS: { text: string; bright?: boolean }[] = [
  { text: "Your Entire Marketing Team" },
  { text: "One AI Platform", bright: true },
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
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-x-0 top-0 mx-auto flex h-full w-full max-w-[80rem] justify-between border-x border-white/5 px-4 sm:px-6">
          <div className="relative h-full w-px overflow-hidden bg-white/5">
            <div className="absolute inset-x-0 top-0 h-[200px] animate-border-beam bg-gradient-to-b from-transparent via-blue-500/40 to-transparent" style={{ animationDuration: "5s" }} />
          </div>
          <div className="relative hidden h-full w-px overflow-hidden bg-white/5 md:block">
            <div className="absolute inset-x-0 top-0 h-[200px] animate-border-beam bg-gradient-to-b from-transparent via-blue-500/40 to-transparent" style={{ animationDuration: "7s", animationDelay: "2s" }} />
          </div>
          <div className="relative hidden h-full w-px overflow-hidden bg-white/5 lg:block">
            <div className="absolute inset-x-0 top-0 h-[200px] animate-border-beam bg-gradient-to-b from-transparent via-blue-500/40 to-transparent" style={{ animationDuration: "5s", animationDelay: "4s" }} />
          </div>
          <div className="relative h-full w-px overflow-hidden bg-white/5">
            <div className="absolute inset-x-0 top-0 h-[200px] animate-border-beam bg-gradient-to-b from-transparent via-blue-500/40 to-transparent" style={{ animationDuration: "8s", animationDelay: "1s" }} />
          </div>
        </div>
      </div>
      <div className="relative z-10 w-full max-w-[90rem] px-2 text-center sm:px-6">
        {/* Headline: Magic UI TextAnimate blurInUp per character, sequenced
            word by word. The vertical gradient lives on each animated
            segment (per-character gradient reads identically for a
            top-to-bottom fade), the wrapper keeps the per-word brightness. */}
        <h1 className="mt-6 flex flex-col items-center text-5xl font-medium leading-[0.98] tracking-[-0.06em] sm:mt-8 sm:text-6xl md:text-8xl md:leading-[1.1]">
          {HEADLINE_WORDS.map((word, i) => (
            <span
              key={word.text}
              className={cn("max-w-full whitespace-normal leading-[1.02] [overflow-wrap:normal] sm:whitespace-nowrap sm:leading-[1.3]", i === 1 && "mt-1 sm:mt-2")}
            >
              {reduce ? (
                <span
                  className={cn(
                    "bg-clip-text text-transparent",
                    word.bright
                      ? "bg-gradient-to-b from-blue-300 to-blue-500"
                      : "bg-gradient-to-b from-white via-white to-white/50",
                  )}
                >
                  {word.text}
                </span>
              ) : (
                <TextAnimate
                  as="span"
                  animation="blurInUp"
                  by="word"
                  once
                  delay={0.2 + i * 0.1}
                  duration={0.5}
                  segmentClassName={cn(
                    "bg-clip-text text-transparent",
                    word.bright
                      ? "bg-gradient-to-b from-blue-300 to-blue-500"
                      : "bg-gradient-to-b from-white via-white to-white/50",
                  )}
                >
                  {word.text}
                </TextAnimate>
              )}
            </span>
          ))}
        </h1>

        {/* Supporting text: subtle blur-in by word, after the headline lands. */}
        {reduce ? (
          <p className="mx-auto mt-6 max-w-3xl text-pretty text-lg font-medium leading-relaxed text-muted-foreground md:text-2xl">
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
            className="mx-auto mt-6 block max-w-3xl text-pretty text-lg font-medium leading-relaxed text-muted-foreground md:text-2xl"
          >
            Find leads, automate outreach, answer calls, manage DMs, and create
            content with 20+ AI models, all from one workspace.
          </TextAnimate>
        )}

      </div>

      {/* The live services carousel now sits directly below the hero copy. */}
      <div className="relative z-10 mt-8 w-full px-4 sm:px-6 lg:px-9">
        <ServiceRail />
      </div>

      <Enter
        delay={1.2}
        className="relative z-10 mt-10 flex flex-col items-center justify-center gap-6 md:flex-row"
      >
        <AnimatedGenerateButton
          href="/sign-up"
          label="Try now"
          trailingIcon={<ArrowRight aria-hidden className="size-4" />}
          className="min-w-[180px]"
        />

        <BeamButton variant="blue" onClick={seeMore} className="min-w-[180px]">
          See more
          <ChevronDown className="size-3.5 transition-transform duration-300 group-hover:translate-y-0.5" />
        </BeamButton>
      </Enter>

      {/* Keep the original service-name marquee beneath the hero actions. */}
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
    </section>
  );
}

/** The pitch, right after the screen: headline, lede, CTAs, numbers. */
export function Statement() {
  return (
    <section className="relative py-20 sm:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(900px 480px at 50% 30%, oklch(0.62 0.20 255 / 0.14), transparent 70%)",
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
        </motion.div>
      </div>
    </section>
  );
}
