"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  type Variants,
} from "motion/react";
import { cn } from "@/lib/utils";

/**
 * The page-wide container: edge to edge with a slim gutter (the CEO did
 * not want the old 1280px column), capped only for ultra-wide screens.
 */
export const WIDE = "mx-auto w-full max-w-[2200px] px-4 sm:px-6 lg:px-9";

/** Shared motion vocabulary for the landing page — one ease, one rhythm. */
export const EASE = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.8, ease: EASE },
  },
};

export const staggerChildren: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

/** Fades + rises into place the first time it scrolls into view. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      variants={{
        hidden: fadeUp.hidden,
        show: {
          ...(fadeUp.show as object),
          transition: { duration: 0.8, ease: EASE, delay },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

/** A group whose children (each an <Item>) reveal one after another. */
export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      variants={staggerChildren}
    >
      {children}
    </motion.div>
  );
}

export function Item({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={fadeUp}>
      {children}
    </motion.div>
  );
}

/** Section frame: eyebrow, headline (with an italic accent), lede. */
export function Section({
  id,
  eyebrow,
  title,
  accent,
  description,
  children,
  className,
  align = "center",
}: {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  /** Rendered in the display serif, gold — the emotional word. */
  accent?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
  align?: "center" | "left";
}) {
  return (
    <section id={id} className={cn("relative scroll-mt-24 py-20 sm:py-28", className)}>
      <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-9">
        <Reveal
          className={cn(
            "mb-12 max-w-2xl sm:mb-16",
            align === "center" && "mx-auto text-center",
          )}
        >
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
            {title}
            {accent && (
              <>
                {" "}
                <span className="font-display font-normal italic text-primary">
                  {accent}
                </span>
              </>
            )}
          </h2>
          {description && (
            <p className="mt-4 text-pretty text-base text-muted-foreground sm:text-lg">
              {description}
            </p>
          )}
        </Reveal>
        {children}
      </div>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
      {children}
    </span>
  );
}

/**
 * Card with a gold spotlight that follows the cursor and a border that
 * brightens on hover — the landing page's main surface.
 */
export function GlowCard({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article";
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Tag
      ref={ref as never}
      onMouseMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
        el.style.setProperty("--my", `${e.clientY - rect.top}px`);
      }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-white/10 bg-card/70 backdrop-blur-sm transition-colors duration-300 hover:border-primary/40",
        "before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-500 group-hover:before:opacity-100 hover:before:opacity-100",
        "before:[background:radial-gradient(420px_circle_at_var(--mx,50%)_var(--my,50%),oklch(0.86_0.17_93/0.14),transparent_60%)]",
        className,
      )}
    >
      <div className="relative">{children}</div>
    </Tag>
  );
}

/** Counts up from 0 the first time it's seen. */
export function Counter({
  to,
  prefix = "",
  suffix = "",
  decimals = 0,
  className,
}: {
  to: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const value = useMotionValue(0);
  const [shown, setShown] = useState(0);

  // The motion value drives the text; the effect only starts the tween.
  useMotionValueEvent(value, "change", (v) => setShown(v));
  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(value, to, { duration: 1.6, ease: EASE });
    return () => controls.stop();
  }, [inView, to, reduce, value]);

  const number = reduce ? to : shown;
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {prefix}
      {number.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}

/** Endless horizontal scroll; content is duplicated so the loop is seamless. */
export function Marquee({
  children,
  reverse = false,
  duration = 40,
  className,
}: {
  children: ReactNode;
  reverse?: boolean;
  duration?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group/marquee flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]",
        className,
      )}
    >
      {[0, 1].map((copy) => (
        <div
          key={copy}
          aria-hidden={copy === 1}
          className="flex shrink-0 items-center gap-3 pr-3 animate-marquee group-hover/marquee:[animation-play-state:paused]"
          style={{
            animationDuration: `${duration}s`,
            animationDirection: reverse ? "reverse" : "normal",
          }}
        >
          {children}
        </div>
      ))}
    </div>
  );
}

/** Film-grain overlay — the texture both reference sites lean on. */
export function Grain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[1] opacity-[0.035] mix-blend-overlay"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
      }}
    />
  );
}

/** Soft gold light + fine grid behind a section. */
export function Backdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10", className)}>
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 480px at 50% -10%, oklch(0.86 0.17 93 / 0.16), transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
        style={{
          backgroundImage:
            "linear-gradient(to right, oklch(1 0 0 / 0.06) 1px, transparent 1px), linear-gradient(to bottom, oklch(1 0 0 / 0.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}

/**
 * A muted, looping clip that only plays while on screen (and never when
 * the visitor prefers reduced motion). The poster + whatever sits behind
 * it carry the tile until the file arrives, so nothing flashes.
 */
export function TileVideo({
  src,
  poster,
  className,
}: {
  src: string;
  poster?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const inView = useInView(ref, { margin: "160px" });
  const reduced = useReducedMotion();

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (inView && !reduced) {
      const attempt = video.play();
      // Autoplay can be refused (data saver, power saving) — the poster stays.
      if (attempt) attempt.catch(() => {});
    } else {
      video.pause();
    }
  }, [inView, reduced]);

  return (
    <video
      ref={ref}
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden
    />
  );
}
