"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  AudioWaveform,
  Check,
  ChevronDown,
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Backdrop,
  EASE,
  GlowCard,
  Item,
  Marquee,
  Reveal,
  Section,
  Stagger,
  TileVideo,
} from "./primitives";

// ── Model / integration marquee ─────────────────────────────────────────

const MODELS = [
  "Kling 3.0", "Seedance 2.5", "Higgsfield Soul 2", "Cinema Studio 4.0",
  "Genjutsu", "Google Veo 3", "FLUX Pro 1.1", "Ideogram V3", "Recraft V3",
  "Luma Ray 2", "MiniMax Hailuo", "Nano Banana",
];
const STACK = [
  "ElevenLabs voices", "Bland AI calls", "Recall.ai meeting bots",
  "Instagram DMs", "Cal.com booking", "Instantly email", "Google Maps leads",
  "LinkedIn leads", "Claude by Anthropic",
];

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-foreground/85 whitespace-nowrap">
      <span className="size-1.5 rounded-full bg-primary" />
      {children}
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
          {MODELS.map((m) => <Chip key={m}>{m}</Chip>)}
        </Marquee>
        <Marquee duration={52} reverse>
          {STACK.map((m) => <Chip key={m}>{m}</Chip>)}
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

function InboxVisual() {
  return (
    <div className="mt-5 space-y-2">
      {[
        ["Dr. Patel · Bright Dental", "Interested", "AI drafted"],
        ["Marco · Luna Pasta", "Meeting booked", "Sent"],
        ["Sofia · Glow Med Spa", "Asked for pricing", "AI drafted"],
      ].map(([who, state, tag]) => (
        <div key={who} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-xs">
          <div className="min-w-0">
            <p className="truncate font-medium">{who}</p>
            <p className="truncate text-muted-foreground">{state}</p>
          </div>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px]", tag === "Sent" ? "bg-emerald-500/15 text-emerald-400" : "bg-primary/15 text-primary")}>
            {tag}
          </span>
        </div>
      ))}
    </div>
  );
}

function TriageVisual() {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {[
        ["Needs reply", "12"], ["Qualified", "44"], ["Booking-ready", "9"], ["Mine", "6"],
      ].map(([label, n]) => (
        <span key={label} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs">
          {label} <span className="ml-1 text-muted-foreground">{n}</span>
        </span>
      ))}
      <span className="rounded-full bg-primary/15 px-3 py-1 text-xs text-primary">Autopilot · guardrails on</span>
    </div>
  );
}

function StudioVisual() {
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
  },
  {
    icon: PhoneCall,
    title: "AI Receptionist",
    blurb: "Answers every call, 24/7, books straight onto your calendar, and hands you the transcript and summary.",
  },
  {
    icon: PhoneOutgoing,
    title: "Lead Qualifier",
    blurb: "Calls your leads, asks your questions, and tells you exactly who is worth your time.",
  },
  {
    icon: AudioWaveform,
    title: "Clone Your Voice",
    blurb: "15 seconds of talking. Then every call and voice DM sounds like you — Bland or ElevenLabs, your pick.",
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
  },
];

export function Features() {
  return (
    <Section
      id="features"
      eyebrow="What's inside"
      title="Nine tools you'd normally rent,"
      accent="one login."
      description="Each one runs on its own. Together they hand off to each other: a lead found becomes a call booked becomes a client answered."
      className="relative"
    >
      <Backdrop />
      <Stagger className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((f) => (
          <Item key={f.title} className={cn(f.wide && "md:col-span-2")}>
            <GlowCard as="article" className="h-full p-6">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <f.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.blurb}</p>
              {f.visual}
            </GlowCard>
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
        <GlowCard className="grid gap-8 p-6 sm:p-10 lg:grid-cols-2 lg:items-center">
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
              <span className="flex gap-1 rounded-full bg-white/5 p-1">
                <span className="rounded-full bg-background px-2.5 py-1 text-foreground shadow-sm">Bland</span>
                <span className="px-2.5 py-1">ElevenLabs</span>
              </span>
            </div>
          </div>
          <div>
            <ul className="space-y-3">
              {VOICE_USES.map(([name, what]) => (
                <li key={name} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Check className="size-3" />
                  </span>
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
  return (
    <Section eyebrow="How it works" title="Live in an afternoon," accent="not a quarter.">
      <div className="relative">
        <svg aria-hidden className="pointer-events-none absolute left-0 top-7 hidden h-px w-full md:block" viewBox="0 0 100 1" preserveAspectRatio="none">
          <motion.line
            x1="0" y1="0.5" x2="100" y2="0.5"
            stroke="oklch(0.86 0.17 93 / 0.5)" strokeWidth="1" vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.6, ease: EASE }}
          />
        </svg>
        <Stagger className="grid gap-8 md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <Item key={title} className="relative">
              <span className="relative z-10 flex size-14 items-center justify-center rounded-full border border-primary/40 bg-background font-display text-2xl italic text-primary">
                {i + 1}
              </span>
              <h3 className="mt-5 text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </Item>
          ))}
        </Stagger>
      </div>
    </Section>
  );
}

// ── Pricing ─────────────────────────────────────────────────────────────

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "",
    blurb: "Explore the platform. Done-for-you onboarding unlocks with an invite code.",
    features: ["Onboarding forms (with an invite code)", "Support tickets", "Referral link"],
    cta: "Create account",
    featured: false,
  },
  {
    name: "Personal",
    price: "$97",
    period: "/mo",
    blurb: "Every tool, for one business.",
    features: [
      "10,000 credits every month",
      "Outreach, leads, receptionist & qualifier",
      "Clone Your Voice",
      "IG DMs & AI Voice, AI Note Taker",
      "Create with AI + Studio",
      "Referral payouts",
    ],
    cta: "Start Personal",
    featured: true,
  },
  {
    name: "Team / Agency",
    price: "$297",
    period: "/mo",
    blurb: "Everything, for a team or your clients.",
    features: [
      "30,000 credits every month",
      "Team members share leads, inboxes & credits",
      "Assign conversations to setters",
      "Agency features",
      "Priority support",
    ],
    cta: "Start Team",
    featured: false,
  },
];

export function Pricing() {
  return (
    <Section
      id="pricing"
      eyebrow="Pricing"
      title="Simple plans,"
      accent="one credit balance."
      description="Credits pay for calls, generations, voice notes and meeting recording. Every price shows before you click, and you can top up any time."
    >
      <Stagger className="grid gap-4 md:grid-cols-3 md:items-stretch">
        {PLANS.map((plan) => (
          <Item key={plan.name}>
            <GlowCard
              as="article"
              className={cn(
                "flex h-full flex-col p-6 sm:p-7",
                plan.featured && "border-primary/50 shadow-[0_0_60px_-20px_oklch(0.86_0.17_93/0.6)]",
              )}
            >
              {plan.featured && (
                <span className="mb-4 w-fit rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{plan.blurb}</p>
              <p className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight">{plan.price}</span>
                <span className="text-sm text-muted-foreground">{plan.period}</span>
              </p>
              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button asChild variant={plan.featured ? "default" : "outline"} className="mt-8 rounded-full">
                <Link href="/sign-up">{plan.cta}</Link>
              </Button>
            </GlowCard>
          </Item>
        ))}
      </Stagger>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Prices in USD. Cancel any time. Referrals earn a share of every plan you bring in.
      </p>
    </Section>
  );
}

// ── FAQ ─────────────────────────────────────────────────────────────────

const FAQS = [
  ["What are credits?", "One balance pays for everything — call minutes, image and video generations, voice notes, meeting recording. Plans include a monthly allowance, you can top up any time, and every price is shown before you confirm."],
  ["Does the receptionist really use my voice?", "Yes. Record fifteen seconds of yourself talking. From then on inbound calls, qualifier calls and Instagram voice notes speak in your clone."],
  ["Can I connect my own Instagram?", "Yes — a Professional account (Business or Creator) linked to a Facebook Page, connected with a single Meta authorization click. Every DM lands in your inbox with AI triage."],
  ["Which meeting apps does the Note Taker join?", "Zoom, Google Meet and Microsoft Teams. It joins as a named participant, announces itself, and the notes arrive minutes after the call ends."],
  ["Do I need my own AI subscriptions?", "No. Kling, Seedance, Higgsfield, Veo, FLUX, ElevenLabs and the rest are already connected and billed per generation from your credits."],
  ["Can my team use it?", "The Team plan adds members who share leads, inboxes, campaigns and credits, lets you assign conversations to setters, and unlocks agency features."],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Section id="faq" eyebrow="FAQ" title="Questions," accent="answered." align="center">
      <Reveal className="mx-auto max-w-3xl divide-y divide-white/10 rounded-2xl border border-white/10 bg-card/60">
        {FAQS.map(([q, a], i) => {
          const isOpen = open === i;
          return (
            <div key={q}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              >
                <span className="text-base font-medium">{q}</span>
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300", isOpen && "rotate-180 text-primary")} />
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
                    <p className="px-6 pb-6 text-sm text-muted-foreground">{a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </Reveal>
    </Section>
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
                "radial-gradient(800px 400px at 50% 120%, oklch(0.86 0.17 93 / 0.35), transparent 70%), linear-gradient(to bottom, oklch(0.17 0.004 90), oklch(0.13 0 0))",
            }}
          />
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
            Ready to hand the busywork{" "}
            <span className="font-display font-normal italic text-primary">to AI?</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-muted-foreground sm:text-lg">
            Start on the free plan, clone your voice, and let the first call answer itself.
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
