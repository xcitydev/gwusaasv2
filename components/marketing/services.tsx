"use client";

import type { ComponentType } from "react";
import { motion, useReducedMotion } from "motion/react";
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
import { EASE, Marquee } from "./primitives";
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

/** "Your growth team" — centered headline like the other sections, then an
    auto-sliding marquee of service cards with live mini-visuals. */
export function ServiceRail() {
  const reduce = useReducedMotion();
  return (
    <section id="services" aria-labelledby="services-title" className="scroll-mt-24 pt-8 sm:pt-12">
      <div className="mx-auto max-w-2xl text-center">
        <motion.h2
          id="services-title"
          initial={reduce ? false : { opacity: 0, y: 12, filter: "blur(6px)" }}
          whileInView={reduce ? undefined : { opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl"
        >
          Your Entire Growth Team, {" "}
          <span className="bg-gradient-to-b from-blue-300 to-blue-500 bg-clip-text text-transparent">
            Powered by AI.
          </span>
        </motion.h2>
        <p className="mt-4 text-pretty text-base text-muted-foreground sm:text-lg">
          10+ AI services that hand off to each other: a lead found becomes a call booked becomes a client answered.
        </p>
      </div>

      <div className="relative mt-10">
        <Marquee duration={70} className="items-stretch">
          {SERVICES.map((s) => (
            <div key={s.id} className="mx-3 w-[78vw] max-w-[300px] shrink-0 sm:w-[300px] lg:w-[318px]">
              <ServiceCard service={s} active={false} />
            </div>
          ))}
        </Marquee>
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
