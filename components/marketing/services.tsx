"use client";

import { useEffect, useRef, useState, type ComponentType, type PointerEvent } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import {
  ArrowRight,
  AudioWaveform,
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
import { EASE } from "./primitives";
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
 * The launch services and their copy. The hero marquee renders the names +
 * icons; the "Your growth team" rail below it renders the full cards.
 */

type Service = {
  id: string;
  icon: LucideIcon;
  /** Short name for the marquee / dock. */
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

/** Auto-sliding service cards with live mini-visuals. */
export function ServiceRail() {
  const [dragging, setDragging] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const hoveringRef = useRef(false);
  const drag = useRef<{ pointerId: number; startX: number; startScroll: number; moved: boolean; didDrag: boolean } | null>(null);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const updatePause = () => {
      const track = rail.firstElementChild as HTMLElement | null;
      if (track) track.style.animationPlayState = draggingRef.current || hoveringRef.current ? "paused" : "running";
    };
    const observer = new ResizeObserver(updatePause);
    observer.observe(rail);
    updatePause();
    return () => observer.disconnect();
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.pointerType === "mouse" && event.button !== 0) || drag.current) return;
    const rail = railRef.current;
    if (!rail) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: rail.scrollLeft,
      moved: false,
      didDrag: false,
    };
    draggingRef.current = true;
    const track = rail.firstElementChild as HTMLElement | null;
    if (track) track.style.animationPlayState = "paused";
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - state.startX) > 5) {
      state.moved = true;
      state.didDrag = true;
    }
    if (state.moved && railRef.current) railRef.current.scrollLeft = state.startScroll - (event.clientX - state.startX);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (drag.current.didDrag) {
      const suppressClick = (clickEvent: MouseEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
      };
      railRef.current?.addEventListener("click", suppressClick, { capture: true, once: true });
      window.setTimeout(() => railRef.current?.removeEventListener("click", suppressClick, true), 0);
    }
    drag.current = null;
    draggingRef.current = false;
    const track = railRef.current?.firstElementChild as HTMLElement | null;
    if (track) track.style.animationPlayState = hoveringRef.current ? "paused" : "running";
    setDragging(false);
  };

  return (
    <section id="services" aria-label="AI services" className="scroll-mt-24">
      <div className="relative">
        <div
          ref={railRef}
          className={cn("service-rail overflow-x-auto cursor-grab touch-pan-y select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", dragging && "cursor-grabbing")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onMouseEnter={() => {
            hoveringRef.current = true;
            const track = railRef.current?.firstElementChild as HTMLElement | null;
            if (track) track.style.animationPlayState = "paused";
          }}
          onMouseLeave={() => {
            hoveringRef.current = false;
            if (!drag.current) {
              const track = railRef.current?.firstElementChild as HTMLElement | null;
              if (track) track.style.animationPlayState = "running";
            }
          }}
          onDragStart={(event) => event.preventDefault()}
        >
        <div className="service-rail-track flex w-max items-stretch py-1">
          {SERVICES.map((s) => (
            <div key={s.id} className="mx-3 w-[78vw] max-w-[300px] shrink-0 sm:w-[300px] lg:w-[318px]">
              <ServiceCard service={s} active={false} />
            </div>
          ))}
          {SERVICES.map((s) => (
            <div key={`copy-${s.id}`} aria-hidden="true" className="mx-3 w-[78vw] max-w-[300px] shrink-0 sm:w-[300px] lg:w-[318px]">
              <ServiceCard service={s} active={false} />
            </div>
          ))}
        </div>
        </div>
      </div>
    </section>
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
          ? "border-primary/45 shadow-[0_0_60px_-24px_oklch(0.62_0.20_255/0.8)]"
          : "border-white/10 hover:border-white/20",
      )}
    >
      <div className="relative h-[200px] overflow-hidden bg-[radial-gradient(120%_90%_at_30%_0%,oklch(0.62_0.20_255/0.14),transparent_60%)] px-4 pt-12 [&>*]:mt-0">
        <span className="absolute left-3.5 top-3.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
          {s.tag}
        </span>
        <s.Visual />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="flex items-center gap-2.5 text-base font-semibold sm:text-lg">
          <s.icon className="size-6 shrink-0 text-primary" strokeWidth={3} aria-hidden />
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
