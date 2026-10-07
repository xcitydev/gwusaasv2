"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  AudioWaveform,
  MessageCircle,
  NotebookPen,
  PhoneCall,
  PhoneOutgoing,
  Send,
  Sparkles,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import { usePendingInvite } from "./use-pending-invite";

const EASE = [0.22, 1, 0.36, 1] as const;

const SERVICES = [
  { name: "Cold Email", icon: Send },
  { name: "Find Leads", icon: Users },
  { name: "Receptionist", icon: PhoneCall },
  { name: "Qualifier", icon: PhoneOutgoing },
  { name: "Voice Clone", icon: AudioWaveform },
  { name: "IG DMs", icon: MessageCircle },
  { name: "Note Taker", icon: NotebookPen },
  { name: "Studio", icon: Sparkles },
  { name: "AI Tools", icon: Wrench },
];

const INVITE_STEPS = [
  ["Create your account", "Or sign in if you already have one"],
  ["Forms unlock instantly", "Your invite is applied automatically"],
  ["We get to work", "Done-for-you, reviewed by our team"],
];

const BRAND_TEXT =
  "bg-gradient-to-b from-[#5cc3ff] via-[#8a5cfc] to-[#e24ff9] bg-clip-text text-transparent";

function ScreenVideo() {
  const reduce = useReducedMotion();
  return (
    <>
      {reduce ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/hero-poster.jpg" alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <video
          className="absolute inset-0 size-full object-cover"
          src="/hero.mp4"
          poster="/hero-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/5 to-black/85" />
    </>
  );
}

/** Desktop: the cinematic left half of the auth screen. */
export function AuthShowcase() {
  const invite = usePendingInvite();

  return (
    <div className="sticky top-4 hidden h-[calc(100dvh-2rem)] rounded-[2.1rem] bg-[#0a0a0a] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] lg:block">
      <div className="relative size-full overflow-hidden rounded-[1.5rem]">
        <ScreenVideo />

        <Link href="/" className="absolute left-8 top-7 flex items-center gap-2.5">
          <Image src={BRAND.logo.wordmark} alt={BRAND.name} width={867} height={192} className="h-8 w-auto" priority />
        </Link>
        <Link
          href="/"
          className="absolute right-7 top-6 flex items-center gap-1.5 rounded-full border border-white/20 bg-black/40 px-3.5 py-2 text-[13px] backdrop-blur-md transition-colors hover:border-primary/50 hover:text-primary"
        >
          <ArrowLeft className="size-3.5" /> Back to site
        </Link>

        <motion.div
          key={invite ? "invite" : "default"}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
          className="absolute inset-x-10 bottom-10 flex flex-col gap-5"
        >
          {invite ? (
            <>
              <span className="flex w-fit items-center gap-2 rounded-full border border-primary/45 bg-black/45 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-primary backdrop-blur-md">
                <span className="size-1.5 rounded-full bg-primary" /> Private invite
              </span>
              <h2
                className={`font-black uppercase leading-[0.9] tracking-[-0.04em] drop-shadow-[0_18px_40px_rgba(0,0,0,0.7)] ${BRAND_TEXT}`}
                style={{ fontSize: "clamp(3rem, 5.6vw, 5.5rem)" }}
              >
                Your onboarding
                <br />
                starts here
              </h2>
              <p className="max-w-xl text-lg leading-relaxed text-white/80">
                You&apos;ve been invited to the{" "}
                <span className="font-display text-xl italic text-primary">Creatily Onboarding Forms</span>{" "}
                — tell us about your business once and we take it from there.
              </p>
              <ol className="grid grid-cols-3 gap-4 rounded-2xl border border-white/15 bg-black/45 p-5 backdrop-blur-xl">
                {INVITE_STEPS.map(([title, sub], i) => (
                  <li key={title} className="flex flex-col gap-1">
                    <span className="font-display text-2xl italic text-primary">{i + 1}</span>
                    <span className="text-sm font-semibold">{title}</span>
                    <span className="text-xs text-white/60">{sub}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <h2
                className={`font-black uppercase leading-[0.88] tracking-[-0.045em] drop-shadow-[0_18px_40px_rgba(0,0,0,0.7)] ${BRAND_TEXT}`}
                style={{ fontSize: "clamp(3.5rem, 6.6vw, 6.5rem)" }}
              >
                Creatily
              </h2>
              <p className="max-w-lg text-lg leading-relaxed text-white/80">
                Your whole growth team, run by AI — outreach, calls, DMs, meeting notes and a full
                studio in one login.
              </p>
              <div className="rounded-2xl border border-white/15 bg-black/45 p-4 backdrop-blur-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/75">
                  What you unlock · 10+ AI services
                </p>
                <ul className="mt-3 grid grid-cols-9 gap-1.5">
                  {SERVICES.map((s, i) => (
                    <motion.li
                      key={s.name}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 + i * 0.05, ease: EASE }}
                      className="flex flex-col items-center gap-1.5 text-center"
                    >
                      <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                        <s.icon className="size-[18px]" />
                      </span>
                      <span className="text-[11px] leading-tight text-white/85">{s.name}</span>
                    </motion.li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}

/** Phones and tablets: a short screen banner above the form. */
export function AuthBanner() {
  const invite = usePendingInvite();
  return (
    <div className="rounded-[1.6rem] bg-[#0a0a0a] p-[7px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] lg:hidden">
      <div className="relative h-40 overflow-hidden rounded-[1.25rem] sm:h-56">
        <ScreenVideo />
        <Link href="/" className="absolute left-4 top-3.5 flex items-center gap-2">
          <Image src={BRAND.logo.wordmark} alt={BRAND.name} width={867} height={192} className="h-6 w-auto" priority />
        </Link>
        <Link
          href="/"
          aria-label="Back to site"
          className="absolute right-2.5 top-2.5 flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/40 backdrop-blur-md"
        >
          <X className="size-4" />
        </Link>
        <p
          className={`absolute bottom-3.5 left-4 font-black uppercase leading-[0.88] tracking-[-0.045em] ${BRAND_TEXT}`}
          style={{ fontSize: invite ? "2.25rem" : "2.9rem" }}
        >
          {invite ? (
            <>
              Your onboarding
              <br />
              starts here
            </>
          ) : (
            <>
              Creatily
            </>
          )}
        </p>
      </div>
    </div>
  );
}
