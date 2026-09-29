"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AnimatePresence, motion } from "motion/react";
import { MousePointerClick, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Guided product tours. A dark overlay spotlights one real element at a
 * time with a gold ring and a tooltip; "click" steps advance when the user
 * clicks the highlighted control itself, "next" steps with a button. Mark
 * targets with data-tour="<name>" anywhere in the page. Progress lives in
 * Convex per user: auto-starts on first visit, never returns after Finish
 * or Skip, and the launcher button replays it on demand.
 */

export type TourStep = {
  /** data-tour value to spotlight; omit for a centered card. */
  target?: string;
  title: string;
  body: string;
  /** "click" = the highlighted element itself advances the tour. */
  advance?: "click" | "next";
};

export type TourDefinition = { id: string; steps: TourStep[] };

const PAD = 6;
const TOOLTIP_W = 336;
const SPRING = { type: "spring", stiffness: 320, damping: 32 } as const;

type Rect = { x: number; y: number; w: number; h: number };

const subscribeNever = () => () => {};

/** Find the step's element, scroll it into view, and track its rect live. */
function useTargetRect(selector: string | null, stepIndex: number) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);

  // Reset during render when the step changes (not in an effect).
  const key = `${selector ?? ""}|${stepIndex}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setRect(null);
    setMissing(false);
  }

  useEffect(() => {
    if (!selector) return;
    let el: Element | null = null;
    let tries = 0;
    let track: ReturnType<typeof setInterval> | null = null;
    const measure = () => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    const attempt = () => {
      el = document.querySelector(`[data-tour="${selector}"]`);
      if (el) {
        clearInterval(find);
        el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        measure();
        // Follow the element through scrolling, resizes and layout shifts.
        track = setInterval(measure, 250);
        window.addEventListener("scroll", measure, true);
        window.addEventListener("resize", measure);
      } else if (++tries > 20) {
        clearInterval(find);
        setMissing(true);
      }
    };
    const find = setInterval(attempt, 150);
    return () => {
      clearInterval(find);
      if (track) clearInterval(track);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [selector, stepIndex]);

  return { rect, missing };
}

function TourOverlay({
  tour,
  stepIndex,
  onAdvance,
  onSkip,
}: {
  tour: TourDefinition;
  stepIndex: number;
  onAdvance: () => void;
  onSkip: () => void;
}) {
  const step = tour.steps[stepIndex];
  const isClick = step.advance === "click";
  const { rect, missing } = useTargetRect(step.target ?? null, stepIndex);
  // Only rendered inside a client portal, so window exists at first render.
  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));

  useEffect(() => {
    const read = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  // Skip on Escape, from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  // "Click" steps: the real element advances the tour (after its own action).
  const found = rect !== null;
  useEffect(() => {
    if (!isClick || !found || !step.target) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;
    const onClick = () => setTimeout(onAdvance, 350);
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [isClick, found, step.target, onAdvance]);

  const mobile = viewport.w < 640;
  const centered = !step.target || (missing && !rect);
  const hole = rect
    ? {
        x: Math.max(0, rect.x - PAD),
        y: Math.max(0, rect.y - PAD),
        w: rect.w + PAD * 2,
        h: rect.h + PAD * 2,
      }
    : null;

  // The root is click-transparent; only the shades and tooltip catch clicks,
  // so the spotlight hole is a real hole and the target stays clickable.
  const shade = "pointer-events-auto fixed bg-black/70";
  const last = stepIndex === tour.steps.length - 1;

  // Tooltip beside the spotlight on desktop; bottom sheet on phones.
  const below = hole ? hole.y + hole.h + 220 < viewport.h : true;
  const tooltipStyle =
    mobile || centered || !hole
      ? undefined
      : {
          left: Math.min(Math.max(12, hole.x), Math.max(12, viewport.w - TOOLTIP_W - 12)),
          ...(below
            ? { top: hole.y + hole.h + 14 }
            : { bottom: viewport.h - hole.y + 14 }),
        };

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]" role="dialog" aria-label={step.title}>
      {centered || !hole ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`${shade} inset-0`}
        />
      ) : (
        <>
          {/* Four shade panels around the spotlight hole. */}
          <motion.div className={shade} animate={{ left: 0, top: 0, width: viewport.w, height: hole.y }} transition={SPRING} initial={false} style={{ left: 0, top: 0 }} />
          <motion.div className={shade} animate={{ left: 0, top: hole.y + hole.h, width: viewport.w, height: Math.max(0, viewport.h - hole.y - hole.h) }} transition={SPRING} initial={false} style={{ left: 0 }} />
          <motion.div className={shade} animate={{ left: 0, top: hole.y, width: hole.x, height: hole.h }} transition={SPRING} initial={false} style={{ left: 0 }} />
          <motion.div className={shade} animate={{ left: hole.x + hole.w, top: hole.y, width: Math.max(0, viewport.w - hole.x - hole.w), height: hole.h }} transition={SPRING} initial={false} />
          {/* Gold ring on the target. */}
          <motion.div
            className="pointer-events-none fixed rounded-xl border-2 border-primary shadow-[0_0_0_4px_oklch(0.86_0.17_93/0.25),0_0_40px_-4px_oklch(0.86_0.17_93/0.8)]"
            animate={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
            transition={SPRING}
            initial={false}
          />
          {/* "Next" steps: the target is show-only, keep it un-clickable. */}
          {!isClick && (
            <div
              className="pointer-events-auto fixed"
              style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
            />
          )}
        </>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={stepIndex}
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className={
            centered
              ? "pointer-events-auto fixed inset-x-4 top-1/2 mx-auto max-w-sm -translate-y-1/2"
              : mobile
                ? "pointer-events-auto fixed inset-x-3 bottom-3"
                : "pointer-events-auto fixed"
          }
          style={{ ...tooltipStyle, ...(!centered && !mobile && { width: TOOLTIP_W }) }}
        >
          <div className="relative rounded-2xl border border-primary/30 bg-[#141310] p-5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.9),0_0_40px_-20px_oklch(0.86_0.17_93/0.5)]">
            <button
              type="button"
              onClick={onSkip}
              aria-label="Skip tour"
              className="absolute right-3 top-3 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
              {stepIndex + 1} / {tour.steps.length}
            </p>
            <h3 className="mt-1.5 pr-6 text-base font-semibold">{step.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{step.body}</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onSkip}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Skip tour
              </button>
              {isClick ? (
                <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <MousePointerClick className="size-4" /> Click the highlighted button
                </span>
              ) : (
                <Button size="sm" className="rounded-full px-4" onClick={onAdvance}>
                  {last ? "Finish" : "Next"}
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * Drop this on a page (e.g. in its header actions): renders the "Show me
 * around" replay button, auto-starts the tour on first visit, and drives it.
 */
export function TourLauncher({ tour }: { tour: TourDefinition }) {
  const progress = useQuery(api.tours.myProgress, { tourId: tour.id });
  const saveStep = useMutation(api.tours.setStep);
  const finish = useMutation(api.tours.finish);
  const restart = useMutation(api.tours.restart);

  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [autoStarted, setAutoStarted] = useState(false);
  // SSR-safe "is the client mounted" without a set-state effect.
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  // First visit (or unfinished last time): start from the top, once.
  // Render-time adjustment, guarded so it runs a single time.
  if (!autoStarted && progress && !progress.seen) {
    setAutoStarted(true);
    setStepIndex(0);
    setActive(true);
  }

  const advance = useCallback(() => {
    setStepIndex((current) => {
      const next = current + 1;
      if (next >= tour.steps.length) {
        setActive(false);
        void finish({ tourId: tour.id, skipped: false });
        return current;
      }
      void saveStep({ tourId: tour.id, step: next });
      return next;
    });
  }, [tour, finish, saveStep]);

  const skip = useCallback(() => {
    setActive(false);
    void finish({ tourId: tour.id, skipped: true });
  }, [tour.id, finish]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void restart({ tourId: tour.id });
          setStepIndex(0);
          setActive(true);
        }}
      >
        <Sparkles className="size-4" /> Show me around
      </Button>
      {mounted &&
        active &&
        createPortal(
          <TourOverlay
            tour={tour}
            stepIndex={stepIndex}
            onAdvance={advance}
            onSkip={skip}
          />,
          document.body,
        )}
    </>
  );
}
