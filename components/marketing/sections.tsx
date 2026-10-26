"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  AudioWaveform,
  CalendarCheck,
  Check,
  Lock,
  MessageCircle,
  Minus,
  NotebookPen,
  PhoneCall,
  PhoneOutgoing,
  Plus,
  Search,
  Send,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextAnimate } from "@/components/ui/text-animate";
import { cn } from "@/lib/utils";
import {
  Backdrop,
  EASE,
  Eyebrow,
  GlowCard,
  Item,
  Marquee,
  Reveal,
  Section,
  Stagger,
  TileVideo,
} from "./primitives";
import { BeamButton } from "./beam-button";
import { Convergence } from "./convergence";
import { BorderBeam } from "@/components/ui/border-beam";

// ── Model / integration marquee ─────────────────────────────────────────

const MODELS = [
  "Kling 3.0", "Seedance 2.5", "Higgsfield Soul 2", "Cinema Studio 4.0",
  "Genjutsu", "Google Veo 3", "FLUX Pro 1.1", "Ideogram V3", "Recraft V3",
  "Luma Ray 2", "MiniMax Hailuo", "Nano Banana",
];
const STACK = [
  "Voice cloning", "AI phone calls", "AI meeting notes",
  "Instagram DMs", "Cal.com booking", "Cold email engine", "Google Maps leads",
  "LinkedIn leads", "AI agents",
];

// Marker shapes for the marquee items (user-supplied glyphs, gray fill).
const SHAPE_PATHS = [
  "M 156 0 C 211.228 0 256 44.772 256 100 L 256 256 L 100 256 C 44.772 256 0 211.228 0 156 L 0 0 Z M 80 80 C 80 133.019 122.981 176 176 176 C 176 122.981 133.019 80 80 80 Z",
  "M 128 64 L 160 33 L 192.5 0 L 256 0 L 256 64 L 192 128 L 191.5 128 L 224 161 L 256 192 L 256 256 L 192 256 L 128 192 L 96 223 L 63.5 256 L 0 256 L 0 192 L 64 128 L 64.5 128 L 32 95 L 0 64 L 0 0 L 64 0 Z",
  "M 128 256 L 64 256 L 64 192 L 128 192 Z M 256 256 L 192 256 L 192 192 L 256 192 Z M 64 192 L 0 192 L 0 128 L 64 128 Z M 192 192 L 128 192 L 128 128 L 192 128 Z M 128 128 L 64 128 L 64 64 L 128 64 Z M 256 128 L 192 128 L 192 64 L 256 64 Z M 64 64 L 0 64 L 0 0 L 64 0 Z M 192 64 L 128 64 L 128 0 L 192 0 Z",
];

function ShapeMark({ seed }: { seed: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 256 256"
      fill="#fb923c"
      className="size-3 shrink-0"
    >
      <path d={SHAPE_PATHS[seed % SHAPE_PATHS.length]} />
    </svg>
  );
}

function Chip({ children, seed }: { children: ReactNode; seed: number }) {
  return (
    <span className="mx-8 flex items-center gap-2.5 whitespace-nowrap text-lg font-medium">
      <ShapeMark seed={seed} />
      <span className="text-white/40 transition-colors duration-700 group-hover/marquee:text-white">
        {children}
      </span>
    </span>
  );
}

export function ModelMarquee() {
  return (
    <div className="relative py-6">
      <p className="mb-5 text-center text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Every model and engine, already connected
      </p>
      <div className="space-y-3">
        <Marquee duration={46}>
          {MODELS.map((m, i) => (
            <Chip key={m} seed={i}>
              {m}
            </Chip>
          ))}
        </Marquee>
        <Marquee duration={52} reverse>
          {STACK.map((m, i) => (
            <Chip key={m} seed={i}>
              {m}
            </Chip>
          ))}
        </Marquee>
      </div>
    </div>
  );
}

// ── Features bento ──────────────────────────────────────────────────────

type Feature = {
  icon: LucideIcon;
  title: string;
  blurb: string;
  wide?: boolean;
  visual?: ReactNode;
};

const INBOX_LEADS = [
  { id: "patel", who: "Dr. Patel · Bright Dental", state: "Interested" },
  { id: "marco", who: "Marco · Luna Pasta", state: "Meeting booked" },
  { id: "sofia", who: "Sofia · Glow Med Spa", state: "Asked for pricing" },
];

const INBOX_CYCLES = [
  [
    ["patel", "AI drafted"],
    ["marco", "Sent"],
    ["sofia", "AI drafted"],
  ],
  [
    ["marco", "AI drafted"],
    ["sofia", "Sent"],
    ["patel", "Sent"],
  ],
  [
    ["sofia", "AI drafted"],
    ["patel", "AI drafted"],
    ["marco", "Sent"],
  ],
] as const;

export function InboxVisual() {
  const reduce = useReducedMotion();
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(() => {
      setCycle((current) => (current + 1) % INBOX_CYCLES.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [reduce]);

  return (
    <div className="mt-5 space-y-2">
      {INBOX_CYCLES[cycle].map(([id, tag], index) => {
        const lead = INBOX_LEADS.find((item) => item.id === id)!;
        return (
          <motion.div
            key={lead.id}
            layout
            transition={{
              layout: reduce
                ? { duration: 0 }
                : { duration: 0.62, delay: index * 0.055, ease: [0.22, 1, 0.36, 1] },
            }}
            className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-xs"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{lead.who}</p>
              <p className="truncate text-muted-foreground">{lead.state}</p>
            </div>
            <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-full px-2 py-0.5 text-[10px] transition-colors duration-300", tag === "Sent" ? "bg-emerald-500/15 text-emerald-400" : "bg-primary/15 text-primary")}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={tag}
                  initial={reduce ? false : { opacity: 0, y: 5, filter: "blur(2px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -5, filter: "blur(2px)" }}
                  transition={reduce ? { duration: 0 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                >
                  {tag}
                </motion.span>
              </AnimatePresence>
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

export function TriageVisual() {
  const reduce = useReducedMotion();
  const [cycle, setCycle] = useState(0);
  const notifications = [
    ["Needs reply", 12],
    ["Qualified", 44],
    ["Booking-ready", 9],
    ["Mine", 6],
  ] as const;

  useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(() => {
      setCycle((current) => current + 1);
    }, 9000);
    return () => window.clearInterval(timer);
  }, [reduce]);

  return (
    <div className="mt-5">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={cycle}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          className="flex flex-wrap gap-2"
        >
          {notifications.map(([label, count], index) => (
            <motion.span
              key={label}
              initial={reduce ? false : { opacity: 0, y: 10, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={reduce ? { duration: 0 } : { delay: index * 0.16, duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs"
            >
              {label}
              <CountUpValue value={count} cycle={cycle} delay={index * 160} reduce={Boolean(reduce)} />
            </motion.span>
          ))}
          <motion.span
            initial={reduce ? false : { opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={reduce ? { duration: 0 } : { delay: notifications.length * 0.16, duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-full bg-primary/15 px-3 py-1 text-xs text-primary"
          >
            Autopilot · guardrails on
          </motion.span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function CountUpValue({
  value,
  cycle,
  delay,
  reduce,
}: {
  value: number;
  cycle: number;
  delay: number;
  reduce: boolean;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (reduce) return;
    let step = 0;
    let interval = 0;
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        step += 1;
        setCount(Math.round((value * step) / 18));
        if (step >= 18) window.clearInterval(interval);
      }, 38);
    }, delay);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [cycle, delay, reduce, value]);

  return <span className="ml-1 tabular-nums text-muted-foreground">{reduce ? value : count}</span>;
}

function Bars({
  count = 24,
  className,
  centered = false,
}: {
  count?: number;
  className?: string;
  centered?: boolean;
}) {
  return (
    <div className={cn("flex gap-[3px]", centered ? "items-center" : "items-end", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <motion.span
          key={i}
          className="flex-1 rounded-full bg-primary/60"
          animate={{ height: ["25%", `${35 + ((i * 47) % 60)}%`, "25%"] }}
          transition={{ duration: 1.1 + (i % 5) * 0.14, repeat: Infinity, ease: "easeInOut", delay: (i % 7) * 0.07 }}
        />
      ))}
    </div>
  );
}

export function LeadsVisual() {
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const phrase = "med spas in Miami";
    if (reduce) return;

    let index = 0;
    let deleting = false;
    let timer = 0;
    const tick = () => {
      if (!deleting) {
        index += 1;
        setQuery(phrase.slice(0, index));
        if (index === phrase.length) {
          deleting = true;
          timer = window.setTimeout(tick, 1700);
          return;
        }
        timer = window.setTimeout(tick, 68);
        return;
      }

      index -= 1;
      setQuery(phrase.slice(0, index));
      if (index === 0) {
        deleting = false;
        timer = window.setTimeout(tick, 550);
        return;
      }
      timer = window.setTimeout(tick, 34);
    };

    timer = window.setTimeout(tick, 450);
    return () => window.clearTimeout(timer);
  }, [reduce]);

  const displayedQuery = reduce ? "med spas in Miami" : query;

  return (
    <div className="mt-5 space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
        <Search className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 truncate text-muted-foreground" aria-label="Search demo: med spas in Miami">
          “{displayedQuery}{!reduce && <span aria-hidden className="ml-px inline-block h-3 w-px animate-pulse bg-primary align-middle" />}”
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">142 found</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["Google Maps", "LinkedIn", "B2B data", "Emails verified"].map((s) => (
          <span key={s} className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-muted-foreground">
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CallVisual() {
  return (
    <div className="mt-5 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
          </span>
          Incoming · 2:14 AM
        </span>
        <span className="text-muted-foreground">0:47</span>
      </div>
      <Bars count={22} className="mt-2.5 h-6" />
      <p className="mt-2.5 flex items-center gap-1.5 text-[10px] text-emerald-400">
        <CalendarCheck className="size-3" /> Booked · Tue 10:30 · invite sent
      </p>
    </div>
  );
}

const QUALIFIER_ROWS: [string, number, string][] = [
  ["Sarah · Bloom Clinic", 92, "Hot"],
  ["Mike · Apex Gym", 64, "Warm"],
  ["Front desk · no answer", 12, "Skip"],
];

export function QualifierVisual() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(() => {
      setPhase((current) => (current + 1) % 3);
    }, 2400);
    return () => window.clearInterval(timer);
  }, [reduce]);

  const states = [
    { label: "Hot", score: 92, badge: "bg-primary/15 text-primary" },
    { label: "Warm", score: 64, badge: "bg-white/10 text-foreground/80" },
    { label: "Skip", score: 12, badge: "bg-white/5 text-muted-foreground" },
  ];

  return (
    <div className="mt-5 space-y-2 text-xs" role="img" aria-label="Illustration of lead scores smoothly cycling through hot, warm, and skip">
      {QUALIFIER_ROWS.map(([who], index) => {
        const state = states[(phase + index) % states.length];
        return (
          <div key={who} className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
            <span className="truncate">{who}</span>
            <span className="ml-auto h-1 w-12 shrink-0 overflow-hidden rounded-full bg-white/10">
              <motion.span
                className="block h-full rounded-full bg-primary"
                initial={false}
                animate={{ width: `${state.score}%` }}
                transition={reduce ? { duration: 0 } : { duration: 0.42, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
              />
            </span>
            <span className={cn("relative grid min-w-10 shrink-0 place-items-center overflow-hidden rounded-full px-2 py-0.5 text-[10px] transition-colors duration-300", state.badge)}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={state.label}
                  initial={reduce ? false : { opacity: 0, y: 5, filter: "blur(2px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -5, filter: "blur(2px)" }}
                  transition={reduce ? { duration: 0 } : { duration: 0.24, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
                >
                  {state.label}
                </motion.span>
              </AnimatePresence>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function VoiceVisual() {
  return (
    <div className="mt-5 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5">
      <div className="relative h-8">
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-primary/15" />
        <Bars count={26} centered className="relative h-full" />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-red-400" /> 0:15
        </span>
        <span className="text-emerald-400">Your voice · ready</span>
      </div>
    </div>
  );
}

export function NotesVisual() {
  return (
    <div className="mt-5 space-y-1.5 text-xs">
      {[
        ["Summary & decisions", "written"],
        ["3 action items", "→ Trello"],
        ["Follow-up email", "drafted"],
      ].map(([item, state]) => (
        <div key={item} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <Check className="size-3 shrink-0 text-primary" />
            <span className="truncate">{item}</span>
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{state}</span>
        </div>
      ))}
    </div>
  );
}

export function ToolsVisual() {
  return (
    <div className="mt-5 grid grid-cols-2 gap-2 text-[11px]">
      {["Get found by AI", "IG carousels", "Audio → text", "Competitor scan"].map((t) => (
        <span key={t} className="rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2 text-foreground/80">
          {t}
        </span>
      ))}
    </div>
  );
}

export function StudioVisual() {
  return (
    <div className="mt-5 grid grid-cols-4 gap-2">
      {STUDIO_TILES.slice(0, 4).map((tile) => (
        <div
          key={tile.clip}
          className={cn("relative aspect-[4/5] overflow-hidden rounded-lg bg-gradient-to-br", tile.art)}
        >
          <TileVideo src={tile.video} poster={tile.poster} />
        </div>
      ))}
    </div>
  );
}

const FEATURES: Feature[] = [
  {
    icon: Send,
    title: "Cold email that books",
    blurb: "Prewarmed inboxes, campaigns that send themselves, and a master inbox where AI drafts every reply in your tone.",
    wide: true,
    visual: <InboxVisual />,
  },
  {
    icon: Users,
    title: "Find your customers",
    blurb: "Say who you want — “med spas in Miami” — and AI searches Google Maps, LinkedIn and B2B databases. Deduped, with verified emails.",
    visual: <LeadsVisual />,
  },
  {
    icon: PhoneCall,
    title: "AI Receptionist",
    blurb: "Answers every call, 24/7, books straight onto your calendar, and hands you the transcript and summary.",
    visual: <CallVisual />,
  },
  {
    icon: PhoneOutgoing,
    title: "Lead Qualifier",
    blurb: "Calls your leads, asks your questions, and tells you exactly who is worth your time.",
    visual: <QualifierVisual />,
  },
  {
    icon: AudioWaveform,
    title: "Clone Your Voice",
    blurb: "15 seconds of talking. Then every call and voice DM sounds like you.",
    visual: <VoiceVisual />,
  },
  {
    icon: MessageCircle,
    title: "IG DMs & AI Voice",
    blurb: "One inbox, AI triage into hot / warm / cold, a copilot that writes in your brand voice, autopilot with guardrails — and voice notes in your clone.",
    wide: true,
    visual: <TriageVisual />,
  },
  {
    icon: NotebookPen,
    title: "AI Note Taker",
    blurb: "Joins Zoom, Meet and Teams, writes the summary, decisions and action items, then answers questions about the meeting.",
    visual: <NotesVisual />,
  },
  {
    icon: Sparkles,
    title: "Create with AI + Studio",
    blurb: "Images, video, motion control and Higgsfield's Studio models — priced per generation, no separate subscriptions.",
    wide: true,
    visual: <StudioVisual />,
  },
  {
    icon: Wrench,
    title: "AI Tools",
    blurb: "Get found by AI, competitor analysis, audio-to-text, and Instagram carousels designed for you.",
    visual: <ToolsVisual />,
  },
];

export function Features() {
  return (
    <Section
      id="features"
      eyebrow="What's inside"
      title="10+ tools you'd normally rent,"
      accent="one login."
      description="Each one runs on its own. Together they hand off to each other: a lead found becomes a call booked becomes a client answered."
      className="relative"
    >
      <Backdrop />
      <Stagger className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((f) => (
          <Item key={f.title} className={cn(f.wide && "md:col-span-2")}>
            <div className="relative isolate h-full overflow-hidden rounded-2xl bg-white/10 p-px">
              <GlowCard as="article" className="h-full border-0 bg-card/80 p-6">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <f.icon className="size-6" strokeWidth={2.5} />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.blurb}</p>
                {f.visual}
              </GlowCard>
              <BorderBeam
                className="z-20"
                duration={10}
                size={72}
                borderWidth={1}
                colorFrom="#fdba74"
                colorTo="#fb923c"
              />
            </div>
          </Item>
        ))}
      </Stagger>
    </Section>
  );
}

// ── Voice ───────────────────────────────────────────────────────────────

const VOICE_USES = [
  ["AI Receptionist", "answers inbound calls sounding like you"],
  ["Lead Qualifier", "makes the outbound calls you don't have time for"],
  ["IG voice DMs", "sends voice notes with a café or office bed under them"],
  ["AI cold calling", "one clone, every conversation"],
];

// User-supplied pinwheel glyph, used as the list bullet in the voice card.
const VOICE_BULLET_PATH =
  "M 112 32 L 54.627 32 L 128 105.373 L 201.373 32 L 144 32 L 144 0 L 256 0 L 256 112 L 224 112 L 224 54.627 L 150.627 128 L 224 201.373 L 224 144 L 256 144 L 256 256 L 144 256 L 144 224 L 201.373 224 L 128 150.627 L 54.627 224 L 112 224 L 112 256 L 0 256 L 0 144 L 32 144 L 32 201.373 L 105.373 128 L 32 54.627 L 32 112 L 0 112 L 0 0 L 112 0 Z";

export function VoiceSection() {
  return (
    <Section
      id="voice"
      eyebrow="Clone Your Voice"
      title="Clone your voice once."
      accent="Use it everywhere."
      description="Record fifteen seconds. From then on the receptionist, the qualifier and your Instagram voice notes all speak in your voice — set them up to run on auto."
    >
      <Reveal>
        <GlowCard className="p-6 sm:p-10">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center lg:gap-20">
          <div>
            <div className="flex h-24 items-end gap-1">
              {Array.from({ length: 40 }).map((_, i) => (
                <motion.span
                  key={i}
                  className="flex-1 rounded-full bg-primary/70"
                  animate={{ height: ["20%", `${30 + ((i * 53) % 70)}%`, "20%"] }}
                  transition={{ duration: 1.2 + (i % 6) * 0.15, repeat: Infinity, ease: "easeInOut", delay: (i % 9) * 0.06 }}
                />
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="size-2 animate-pulse rounded-full bg-red-400" /> Recording · 0:15
              </span>
            </div>
          </div>
          <div className="space-y-10 lg:space-y-8">
            <ul className="space-y-4">
              {VOICE_USES.map(([name, what]) => (
                <li key={name} className="flex items-start gap-3">
                  <svg aria-hidden viewBox="0 0 256 256" className="mt-0.5 size-4 shrink-0 fill-primary">
                    <path d={VOICE_BULLET_PATH} />
                  </svg>
                  <p className="text-sm">
                    <span className="font-medium">{name}</span>{" "}
                    <span className="text-muted-foreground">— {what}</span>
                  </p>
                </li>
              ))}
            </ul>
            <Button asChild className="mt-6 rounded-full">
              <Link href="/sign-up">
                Clone my voice <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
          </div>
        </GlowCard>
      </Reveal>
    </Section>
  );
}

// ── Studio grid ─────────────────────────────────────────────────────────

// Each tile plays a short loop rendered with our own Studio pipeline
// (public/models/<clip>.mp4 + .jpg poster); the gradient sits behind it
// as the fallback while the file loads.
export const STUDIO_TILES = [
  { name: "Soul 2", tag: "Image", clip: "soul-2", art: "from-amber-200/80 via-orange-600/50 to-[#141310]" },
  { name: "Cinema Studio 4.0", tag: "Video", clip: "cinema-studio", art: "from-slate-200/70 via-indigo-700/50 to-[#0f1220]" },
  { name: "Genjutsu", tag: "Motion transfer", clip: "genjutsu", art: "from-fuchsia-300/70 via-purple-700/50 to-[#150f20]" },
  { name: "Kling 3.0 Motion Control", tag: "Motion", clip: "kling-motion", art: "from-lime-200/70 via-emerald-700/50 to-[#0f1a14]" },
  { name: "Seedance 2.5", tag: "Video · audio", clip: "seedance", art: "from-cyan-200/70 via-sky-700/50 to-[#0e1620]" },
  { name: "Google Veo 3", tag: "Video · audio", clip: "veo", art: "from-rose-200/70 via-red-700/50 to-[#1c0f10]" },
  { name: "FLUX Pro 1.1", tag: "Image", clip: "flux", art: "from-yellow-100/80 via-amber-700/50 to-[#1a1408]" },
  { name: "Nano Banana", tag: "Image edit", clip: "nano-banana", art: "from-emerald-200/70 via-teal-700/50 to-[#0e1a18]" },
].map((tile) => ({
  ...tile,
  video: `/models/${tile.clip}.mp4`,
  poster: `/models/${tile.clip}.jpg`,
}));

// ── How it works ────────────────────────────────────────────────────────

const STEPS = [
  ["Connect", "Sign in, add your inboxes, Instagram and calendar. Clone your voice in fifteen seconds."],
  ["Switch on", "Pick a campaign, a receptionist, an autopilot. Set the guardrails — what it may say, when to hand off."],
  ["Watch it work", "Replies, bookings, notes and leads land in one dashboard. You step in only when it matters."],
];

export function HowItWorks() {
  const reduce = useReducedMotion();

  return (
    <Section eyebrow="How it works" title="Live in an afternoon," accent="not a quarter.">
      <div className="relative">
        <svg aria-hidden className="pointer-events-none absolute left-0 top-7 hidden h-px w-full overflow-visible md:block" viewBox="0 0 100 1" preserveAspectRatio="none">
          <defs>
            <linearGradient
              id="how-steps-flow"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2="100"
              y2="0"
              spreadMethod={reduce ? "pad" : "repeat"}
            >
              <stop offset="0%" stopColor="oklch(0.75 0.183 55.934)" stopOpacity="0.5" />
              {!reduce && (
                <>
                  <stop offset="46%" stopColor="oklch(0.75 0.183 55.934)" stopOpacity="0.5" />
                  <stop offset="49%" stopColor="#fff7ed" stopOpacity="1" />
                  <stop offset="51%" stopColor="#fb923c" stopOpacity="1" />
                  <stop offset="54%" stopColor="oklch(0.75 0.183 55.934)" stopOpacity="0.5" />
                  <animateTransform
                    attributeName="gradientTransform"
                    type="translate"
                    from="-100 0"
                    to="0 0"
                    dur="3.4s"
                    repeatCount="indefinite"
                  />
                </>
              )}
              <stop offset="100%" stopColor="oklch(0.75 0.183 55.934)" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          <line
            x1="0" y1="0.5" x2="100" y2="0.5"
            stroke="url(#how-steps-flow)" strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke"
          />
        </svg>
        <Stagger className="grid gap-8 md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <Item key={title} className="relative">
              <span className="relative z-10 flex size-14 items-center justify-center rounded-full border border-primary/40 bg-background font-sans text-2xl font-semibold text-primary">
                {i + 1}
              </span>
              <h3 className="mt-5 text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </Item>
          ))}
        </Stagger>
      </div>
      <Convergence />
    </Section>
  );
}

// ── Pricing ─────────────────────────────────────────────────────────────

/*
 * Paid prices are not on the public site: visitors see the plans, but the
 * numbers are blurred placeholders (the real figures are never in the HTML).
 * After sign-up, the /welcome quiz recommends a plan and reveals its price.
 */
const PLANS = [
  {
    name: "Free",
    price: "0",
    period: "",
    blurb: "Start creating today — pay per use with credits.",
    features: [
      "Create with AI + Studio (priced per render)",
      "Get Found by AI, IG Carousels, Audio to Text",
      "Buy credits any time",
      "Referral link",
    ],
    cta: "Create account",
    featured: false,
    locked: false,
  },
  {
    name: "Personal",
    price: "00",
    period: "/mo",
    blurb: "Every tool, for one business.",
    features: [
      "Outreach, leads, receptionist & qualifier",
      "Clone Your Voice",
      "IG DMs & AI Voice, AI Note Taker",
      "Create with AI + Studio",
      "Referral payouts",
    ],
    cta: "See my price",
    featured: true,
    locked: true,
  },
  {
    name: "Team / Agency",
    price: "000",
    period: "/mo",
    blurb: "Everything, for a team or your clients.",
    features: [
      "Team members share leads, inboxes & credits",
      "Assign conversations to setters",
      "Agency features",
      "Priority support",
    ],
    cta: "See my price",
    featured: false,
    locked: true,
  },
];

/** A blurred stand-in; screen readers hear why instead of the placeholder. */
function Hidden({ children, label }: { children: ReactNode; label: string }) {
  return (
    <>
      <span aria-hidden className="select-none blur-[9px]">{children}</span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/**
 * Pricing (References/pricing.html): dashed-border cards on a 12-col grid,
 * orange in place of the reference's red, the hero's beam buttons as CTAs.
 * The reference's monthly/yearly toggle is omitted — billing is monthly
 * with credits and no yearly prices exist. Locked plans keep the blurred
 * placeholder price; real figures never ship in the public HTML.
 */
export function Pricing() {
  const reduce = useReducedMotion();
  return (
    <section id="pricing" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-9">
        {/* Centered header on the site's own heading typography */}
        <div className="relative mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
            {reduce ? (
              <>
                Simple, transparent{" "}
                <span className="bg-gradient-to-b from-orange-300 to-orange-500 bg-clip-text text-transparent">
                  pricing
                </span>
              </>
            ) : (
              <>
                <TextAnimate as="span" animation="blurIn" by="word" once duration={0.5}>
                  Simple, transparent
                </TextAnimate>{" "}
                <span className="bg-gradient-to-b from-orange-300 to-orange-500 bg-clip-text text-transparent">
                  pricing
                </span>
              </>
            )}
          </h2>
          <p className="mx-auto mt-4 text-pretty text-base text-muted-foreground sm:text-lg">
            Create a free account, answer three quick questions, and we&apos;ll
            unlock the plan that fits you — price included — before you pay a
            thing.
          </p>
          {/* Edge-fade separator under the header, with its soft glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-6 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-6 left-0 right-0 h-6 bg-gradient-to-r from-transparent via-white/10 to-transparent blur-md"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 pt-4 lg:grid-cols-12">
          {PLANS.map((plan) => (
            <PricingCard key={plan.name} plan={plan} />
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Free account, no card required. Your price unlocks after a 30-second
          quiz. Cancel any time.
        </p>
      </div>
    </section>
  );
}

function PricingCard({ plan }: { plan: (typeof PLANS)[number] }) {
  return (
    <div
      className={cn(
        "relative flex flex-col border border-dashed border-zinc-800 p-8 transition-colors duration-300 hover:border-zinc-700 md:p-10 lg:col-span-4",
        plan.featured ? "overflow-hidden bg-zinc-900/30" : "bg-black",
      )}
    >
      {/* Subtle accent glow behind the featured card */}
      {plan.featured && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-orange-500/10 blur-[90px]"
        />
      )}

      <div className="relative z-10 mb-auto">
        <div className={cn("mb-4", plan.featured && "flex items-center justify-between")}>
          <h3 className="text-4xl font-medium tracking-tight text-white">
            {plan.name}
          </h3>
          {plan.featured && (
            <span className="rounded-sm bg-orange-500 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-black shadow-[0_0_10px_rgba(251,146,60,0.35)]">
              Most popular
            </span>
          )}
        </div>
        <p className="mb-8 text-base leading-relaxed text-zinc-400">{plan.blurb}</p>

        <div className="mb-2 flex items-baseline gap-2">
          <span className="translate-y-2 text-[1.5rem] font-medium text-zinc-400">
            $
          </span>
          <span className="text-6xl font-medium tracking-tighter text-white">
            {plan.locked ? (
              <Hidden label="Price shown after you create a free account">
                {plan.price}
              </Hidden>
            ) : (
              plan.price
            )}
          </span>
          {plan.period && (
            <span className="text-lg text-zinc-500">{plan.period}</span>
          )}
        </div>
        {plan.locked && (
          <p className="mb-10 text-sm text-zinc-500">
            Unlocked after a 30-second quiz.
          </p>
        )}

        <BeamButton
          href="/sign-up"
          variant={plan.featured ? "orange" : "white"}
          className="w-full"
        >
          {plan.locked && <Lock className="size-3.5" />}
          {plan.cta}
        </BeamButton>
      </div>

      <div className="my-10 w-full border-t border-zinc-800/80" />

      <div className="relative z-10">
        <h4 className="mb-6 text-sm font-medium uppercase tracking-wider text-white">
          What&apos;s included
        </h4>
        <ul className="space-y-4">
          {plan.locked && (
            <li className="flex items-start gap-3">
              <Check className="mt-0.5 size-4 shrink-0 text-orange-400" />
              <span className="text-sm leading-snug text-zinc-300">
                <Hidden label="A monthly credit allowance">00,000</Hidden>{" "}
                credits every month
              </span>
            </li>
          )}
          {plan.features.map((f) => (
            <li key={f} className="flex items-start gap-3">
              <Check className="mt-0.5 size-4 shrink-0 text-orange-400" />
              <span className="text-sm leading-snug text-zinc-300">{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── FAQ ─────────────────────────────────────────────────────────────────

const FAQS = [
  ["What are credits?", "One balance pays for everything — call minutes, image and video generations, voice notes, meeting recording. Plans include a monthly allowance, you can top up any time, and every price is shown before you confirm."],
  ["Does the receptionist really use my voice?", "Yes. Record fifteen seconds of yourself talking. From then on inbound calls, qualifier calls and Instagram voice notes speak in your clone."],
  ["Can I connect my own Instagram?", "Yes — a Professional account (Business or Creator) linked to a Facebook Page, connected with a single Meta authorization click. Every DM lands in your inbox with AI triage."],
  ["Which meeting apps does the Note Taker join?", "Zoom, Google Meet and Microsoft Teams. It joins as a named participant, announces itself, and the notes arrive minutes after the call ends."],
  ["Do I need my own AI subscriptions?", "No. Kling, Seedance, Higgsfield, Veo, FLUX and the rest are already connected and billed per generation from your credits."],
  ["Can my team use it?", "The Team plan adds members who share leads, inboxes, campaigns and credits, lets you assign conversations to setters, and unlocks agency features."],
];

/**
 * FAQ (References/faw.html): stacked rounded cards; the open card carries
 * the reference's glare gradient in the site's orange instead of violet.
 * Copy is verbatim from the existing FAQS.
 */
export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const reduce = useReducedMotion();
  return (
    <section id="faq" className="relative scroll-mt-24 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-9">
        {/* Centered header, same treatment as the pricing section */}
        <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
            {reduce ? (
              <>
                Questions,{" "}
                <span className="bg-gradient-to-b from-orange-300 to-orange-500 bg-clip-text text-transparent">
                  answered.
                </span>
              </>
            ) : (
              <>
                <TextAnimate as="span" animation="blurIn" by="word" once duration={0.4}>
                  Questions,
                </TextAnimate>{" "}
                <span className="bg-gradient-to-b from-orange-300 to-orange-500 bg-clip-text text-transparent">
                  answered.
                </span>
              </>
            )}
          </h2>
        </div>

        <Reveal className="mx-auto max-w-4xl space-y-5">
          {FAQS.map(([q, a], i) => {
            const isOpen = open === i;
            return (
              <div
                key={q}
                className={cn(
                  "overflow-hidden rounded-3xl border border-white/10 ring-1 ring-white/5 transition-all duration-300",
                  isOpen
                    ? "bg-gradient-to-b from-orange-500/15 via-orange-500/10 to-orange-500/0"
                    : "bg-neutral-900/40 hover:bg-white/5",
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left transition-colors hover:bg-white/5 sm:px-8 sm:py-6"
                >
                  <span className="text-lg font-semibold tracking-tight sm:text-xl">
                    {q}
                  </span>
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/10">
                    <span className="relative flex size-4 items-center justify-center">
                      <Minus
                        className={cn(
                          "absolute size-4 transition-all duration-300",
                          isOpen ? "rotate-0 opacity-100" : "rotate-90 opacity-0",
                        )}
                      />
                      <Plus
                        className={cn(
                          "absolute size-4 transition-all duration-300",
                          isOpen ? "rotate-90 opacity-0" : "rotate-0 opacity-100",
                        )}
                      />
                    </span>
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <p className="px-6 pb-6 text-sm leading-relaxed text-neutral-300 sm:px-8 sm:pb-8 sm:text-base">
                        {a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}

// ── Final CTA ───────────────────────────────────────────────────────────

export function FinalCta() {
  return (
    <section className="px-5 pb-24 sm:px-8">
      <Reveal className="mx-auto max-w-6xl">
        <div className="relative overflow-hidden rounded-3xl border border-primary/30 px-6 py-16 text-center sm:px-12 sm:py-20">
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(800px 400px at 50% 120%, oklch(0.75 0.183 55.934 / 0.3), transparent 70%), radial-gradient(600px 300px at 20% 120%, oklch(0.646 0.222 41.116 / 0.25), transparent 70%), linear-gradient(to bottom, oklch(0.193 0.008 285.6), oklch(0.156 0.006 285.6))",
            }}
          />
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
            Ready to hand the busywork{" "}
            <span className="bg-gradient-to-b from-orange-300 to-orange-500 bg-clip-text text-transparent">to AI?</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-muted-foreground sm:text-lg">
            Start on the free plan — cold email, lead finding, calls answered in
            your cloned voice, Instagram DMs, meeting notes and a full creative
            studio, all in one workspace.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="h-12 rounded-full px-7 text-base">
              <Link href="/sign-up">
                Start free <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-7 text-base">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
