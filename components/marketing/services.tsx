"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ComponentType, type RefObject } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  AudioWaveform,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  NotebookPen,
  PhoneCall,
  PhoneOutgoing,
  Send,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE, Item, Stagger } from "./primitives";
import {
  CallVisual,
  InboxVisual,
  LeadsVisual,
  NotesVisual,
  QualifierVisual,
  StudioVisual,
  ToolsVisual,
  TriageVisual,
  VoiceVisual,
} from "./sections";

/**
 * The services, surfaced above the fold: a glass dock inside the hero
 * screen (desktop), a 3×3 launcher under it (mobile/tablet), and a card rail
 * that both of them scroll to.
 */

type Service = {
  id: string;
  icon: LucideIcon;
  /** Short name for the dock / launcher. */
  name: string;
  /** One-liner under the name in the dock (xl+). */
  sub: string;
  tag: string;
  title: string;
  blurb: string;
  cta: string;
  Visual: ComponentType;
};

export const SERVICES: Service[] = [
  {
    id: "email", icon: Send, name: "Cold Email", sub: "Campaigns that book", tag: "Outreach",
    title: "Cold email that books",
    blurb: "Prewarmed inboxes, campaigns that send themselves, and AI drafts every reply in your tone.",
    cta: "Start outreach", Visual: InboxVisual,
  },
  {
    id: "leads", icon: Users, name: "Find Customers", sub: "Maps · LinkedIn · B2B", tag: "Leads",
    title: "Find your customers",
    blurb: "Say who you want. AI searches Google Maps, LinkedIn and B2B data — deduped, with verified emails.",
    cta: "Find leads", Visual: LeadsVisual,
  },
  {
    id: "receptionist", icon: PhoneCall, name: "AI Receptionist", sub: "Answers 24/7", tag: "Voice",
    title: "AI Receptionist",
    blurb: "Answers every call 24/7 in your voice and books straight onto your calendar.",
    cta: "Set up receptionist", Visual: CallVisual,
  },
  {
    id: "qualifier", icon: PhoneOutgoing, name: "Lead Qualifier", sub: "Calls & scores leads", tag: "Voice",
    title: "Lead Qualifier",
    blurb: "Calls your leads, asks your questions, and tells you exactly who is worth your time.",
    cta: "Qualify leads", Visual: QualifierVisual,
  },
  {
    id: "voice", icon: AudioWaveform, name: "Clone Your Voice", sub: "15 seconds to clone", tag: "Voice",
    title: "Clone Your Voice",
    blurb: "Fifteen seconds of talking — then every call and voice DM sounds like you.",
    cta: "Clone my voice", Visual: VoiceVisual,
  },
  {
    id: "ig", icon: MessageCircle, name: "IG DMs & AI Voice", sub: "Inbox on autopilot", tag: "Social",
    title: "IG DMs & AI Voice",
    blurb: "One inbox, AI triage, a copilot in your brand voice and autopilot with guardrails.",
    cta: "Connect Instagram", Visual: TriageVisual,
  },
  {
    id: "notes", icon: NotebookPen, name: "AI Note Taker", sub: "Zoom · Meet · Teams", tag: "Meetings",
    title: "AI Note Taker",
    blurb: "Joins Zoom, Meet and Teams — writes the summary, decisions and action items.",
    cta: "Add the note taker", Visual: NotesVisual,
  },
  {
    id: "studio", icon: Sparkles, name: "Create with AI", sub: "20+ image & video models", tag: "Studio",
    title: "Create with AI + Studio",
    blurb: "Images, video and motion control from 20+ models — priced per generation.",
    cta: "Open Studio", Visual: StudioVisual,
  },
  {
    id: "tools", icon: Wrench, name: "AI Tools", sub: "Get found by AI", tag: "Growth",
    title: "AI Tools",
    blurb: "Get found by AI, competitor scans, audio-to-text and Instagram carousels.",
    cta: "Try the tools", Visual: ToolsVisual,
  },
];

/** Shared state for the dock, launcher and rail: which service is active, and how to jump to it. */
export function useServiceFocus() {
  const [active, setActive] = useState(SERVICES[0].id);
  const railRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const focus = useCallback(
    (id: string) => {
      setActive(id);
      const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
      document.getElementById("services")?.scrollIntoView({ behavior, block: "start" });
      const rail = railRef.current;
      const card = document.getElementById(`service-${id}`);
      if (rail && card) {
        const inset = parseFloat(getComputedStyle(rail).paddingLeft) || 0;
        rail.scrollTo({ left: card.offsetLeft - inset, behavior });
      }
    },
    [reduce],
  );

  return { active, focus, railRef };
}

type FocusProps = { active: string; onSelect: (id: string) => void };

/** Glass dock pinned to the bottom of the hero screen. Desktop only. */
export function ServiceDock({ active, onSelect }: FocusProps) {
  return (
    <motion.nav
      aria-label="Services"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 1.05, ease: EASE }}
      className="absolute inset-x-5 bottom-5 hidden lg:block"
    >
      <div className="mb-2.5 flex items-center justify-between px-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/75">
          10+ AI services · one login
        </span>
        <button
          type="button"
          onClick={() => onSelect(active)}
          className="flex items-center gap-1 text-xs font-semibold text-primary transition-opacity hover:opacity-80"
        >
          See every service <ChevronDown className="size-3.5" />
        </button>
      </div>
      <ul className="grid grid-cols-9 gap-1.5 rounded-[1.25rem] border border-white/15 bg-black/45 p-2 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
        {SERVICES.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "group flex h-full w-full flex-col items-start gap-2 rounded-2xl border p-3 text-left transition-colors duration-300",
                  on
                    ? "border-primary/45 bg-primary/15"
                    : "border-transparent hover:border-white/10 hover:bg-white/[0.06]",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-xl transition-colors duration-300",
                    on ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary group-hover:bg-primary/25",
                  )}
                >
                  <s.icon className="size-[18px]" />
                </span>
                <span className="text-[13px] font-semibold leading-tight">{s.name}</span>
                <span className="hidden text-[11px] leading-snug text-white/60 xl:block">{s.sub}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </motion.nav>
  );
}

/** 3×3 launcher under the hero screen on phones and tablets. */
export function ServiceLauncher({ active, onSelect }: FocusProps) {
  return (
    <motion.nav
      aria-label="Services"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.9, ease: EASE }}
      className="mt-3 sm:mt-4 lg:hidden"
    >
      <p className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        10+ AI services · one login
      </p>
      <ul className="grid grid-cols-3 gap-2 sm:gap-3">
        {SERVICES.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "flex h-full min-h-[84px] w-full flex-col justify-between gap-2.5 rounded-2xl border bg-card p-3 text-left transition-colors active:scale-[0.98] sm:min-h-0 sm:flex-row sm:items-center sm:justify-start sm:p-4",
                  on ? "border-primary/45 bg-primary/[0.08]" : "border-white/10",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <s.icon className="size-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold leading-tight sm:text-sm">{s.name}</span>
                  <span className="mt-0.5 hidden truncate text-xs text-muted-foreground sm:block">{s.sub}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </motion.nav>
  );
}

/** "Your growth team" — a snap-scrolling rail of service cards with live mini-visuals. */
export function ServiceRail({
  active,
  railRef,
}: {
  active: string;
  railRef: RefObject<HTMLDivElement | null>;
}) {
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, [railRef]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const page = (dir: 1 | -1) => {
    const el = railRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section id="services" aria-labelledby="services-title" className="scroll-mt-24 pt-8 sm:pt-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="services-title" className="text-lg font-black uppercase tracking-tight sm:text-2xl">
            Your growth team
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground sm:text-[15px]">
            10+ AI services that hand off to each other — a lead found becomes a call booked becomes a client answered.
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <RailButton label="Previous services" disabled={edges.start} onClick={() => page(-1)}>
            <ChevronLeft className="size-5" />
          </RailButton>
          <RailButton label="More services" disabled={edges.end} onClick={() => page(1)}>
            <ChevronRight className="size-5" />
          </RailButton>
        </div>
      </div>

      <div className="relative mt-5">
        <div
          ref={railRef}
          onScroll={measure}
          className="relative -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 scrollbar-none sm:-mx-6 sm:scroll-px-6 sm:gap-4 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0"
        >
          <Stagger className="flex gap-3 sm:gap-4">
            {SERVICES.map((s) => (
              <Item key={s.id} className="w-[78vw] max-w-[300px] shrink-0 snap-start sm:w-[300px] lg:w-[318px]">
                <ServiceCard service={s} active={s.id === active} />
              </Item>
            ))}
          </Stagger>
        </div>
        {/* Edge fade, desktop only — on touch the peeking card is the hint. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 hidden w-40 bg-gradient-to-l from-background to-transparent transition-opacity duration-300 lg:block",
            edges.end && "opacity-0",
          )}
        />
      </div>
    </section>
  );
}

function RailButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] transition-colors hover:border-primary/50 hover:text-primary disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function ServiceCard({ service: s, active }: { service: Service; active: boolean }) {
  return (
    <motion.article
      id={`service-${s.id}`}
      whileHover={{ y: -6 }}
      transition={{ duration: 0.35, ease: EASE }}
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-3xl border bg-card transition-[border-color,box-shadow] duration-500",
        active
          ? "border-primary/45 shadow-[0_0_60px_-24px_oklch(0.598_0.241_294.3/0.8)]"
          : "border-white/10 hover:border-white/20",
      )}
    >
      <div className="relative h-[200px] overflow-hidden bg-[radial-gradient(120%_90%_at_30%_0%,oklch(0.598_0.241_294.3/0.14),transparent_60%)] px-4 pt-12 [&>*]:mt-0">
        <span className="absolute left-3.5 top-3.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
          {s.tag}
        </span>
        <s.Visual />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="flex items-center gap-2.5 text-base font-semibold sm:text-lg">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <s.icon className="size-4" />
          </span>
          {s.title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.blurb}</p>
        <Link
          href="/sign-up"
          className="mt-auto flex items-center gap-1.5 pt-4 text-sm font-semibold text-primary transition-[gap] hover:gap-2.5"
        >
          {s.cta} <ArrowRight className="size-4" />
        </Link>
      </div>
    </motion.article>
  );
}
