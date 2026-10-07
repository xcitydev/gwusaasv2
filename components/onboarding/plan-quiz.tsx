"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  AudioWaveform,
  Briefcase,
  Building2,
  Check,
  Loader2,
  Megaphone,
  MessageCircle,
  NotebookPen,
  PhoneCall,
  Sparkles,
  Store,
  User,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * /welcome — three quick questions after sign-up, then the plan that fits is
 * revealed with its price (prices stay off the public site).
 */

type Option = { id: string; label: string; hint: string; icon: LucideIcon };

const AUDIENCES: Option[] = [
  { id: "business", label: "I run a business", hint: "Clinic, gym, shop, service…", icon: Store },
  { id: "agency", label: "I run an agency", hint: "I grow other businesses", icon: Building2 },
  { id: "creator", label: "Creator or coach", hint: "My brand is the business", icon: Megaphone },
  { id: "sales", label: "Sales team", hint: "We book calls for a living", icon: Briefcase },
];

const TEAM_SIZES: Option[] = [
  { id: "solo", label: "Just me", hint: "One login", icon: User },
  { id: "small", label: "2–5 people", hint: "A small team", icon: Users },
  { id: "large", label: "6 or more", hint: "Setters, VAs, clients", icon: UsersRound },
];

const GOALS: Option[] = [
  { id: "leads", label: "Find leads & cold email", hint: "Outreach that books", icon: Megaphone },
  { id: "calls", label: "Answer & qualify calls", hint: "Receptionist + qualifier", icon: PhoneCall },
  { id: "dms", label: "Instagram DMs", hint: "Inbox on autopilot", icon: MessageCircle },
  { id: "notes", label: "Meeting notes", hint: "Zoom, Meet & Teams", icon: NotebookPen },
  { id: "studio", label: "Create content", hint: "Images & video", icon: Sparkles },
  { id: "voice", label: "Clone my voice", hint: "Calls & voice notes", icon: AudioWaveform },
];

const STEPS = [
  { key: "audience", title: "What best describes you?", sub: "So we can point you at the right tools." },
  { key: "teamSize", title: "How many people will use Creatily?", sub: "Teams share leads, inboxes and credits." },
  { key: "goals", title: "What should Creatily handle first?", sub: "Pick as many as you like." },
] as const;

const PLAN_COPY = {
  personal: {
    name: "Personal",
    blurb: "Every tool, for one business.",
    features: [
      "Outreach, leads, receptionist & qualifier",
      "Clone Your Voice",
      "IG DMs & AI Voice, AI Note Taker",
      "Create with AI + Studio",
      "Referral payouts",
    ],
  },
  team: {
    name: "Team / Agency",
    blurb: "Everything, for a team or your clients.",
    features: [
      "Every Personal tool",
      "Team members share leads, inboxes & credits",
      "Assign conversations to setters",
      "Agency features",
      "Priority support",
    ],
  },
} as const;

export function PlanQuiz() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const savePlanQuiz = useMutation(api.users.savePlanQuiz);
  const config = useQuery(api.config.getAll);

  const [step, setStep] = useState(0);
  const [audience, setAudience] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [busy, setBusy] = useState<"submit" | "skip" | null>(null);
  const [result, setResult] = useState<"personal" | "team" | null>(null);

  const canNext = step === 0 ? !!audience : step === 1 ? !!teamSize : goals.length > 0;

  const pick = (id: string) => {
    if (step === 0) setAudience(id);
    else if (step === 1) setTeamSize(id);
    else setGoals((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
    // Single-choice steps advance on their own after a beat.
    if (step < 2) window.setTimeout(() => setStep((s) => Math.min(s + 1, 2)), reduce ? 0 : 260);
  };

  const submit = async () => {
    setBusy("submit");
    try {
      setResult(await savePlanQuiz({ audience, teamSize, goals }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save your answers.");
    } finally {
      setBusy(null);
    }
  };

  const skip = async () => {
    setBusy("skip");
    try {
      await savePlanQuiz({ audience, teamSize, goals, skipped: true });
    } catch {
      // A failed skip only means the quiz shows again next visit.
    }
    router.push("/dashboard");
  };

  if (result) {
    return <PlanReveal plan={result} goals={goals} config={config} />;
  }

  const options = step === 0 ? AUDIENCES : step === 1 ? TEAM_SIZES : GOALS;
  const selected = (id: string) =>
    step === 0 ? audience === id : step === 1 ? teamSize === id : goals.includes(id);

  return (
    <Shell>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
          Step {step + 1} of 3
        </span>
        <button
          type="button"
          onClick={skip}
          disabled={busy !== null}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {busy === "skip" ? "Skipping…" : "Skip for now"}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s.key} className="h-1 overflow-hidden rounded-full bg-white/10">
            <motion.span
              className="block h-full rounded-full bg-primary"
              initial={false}
              animate={{ width: i <= step ? "100%" : "0%" }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            />
          </span>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduce ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? undefined : { opacity: 0, x: -24 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1 className="mt-7 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            {STEPS[step].title}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{STEPS[step].sub}</p>

          <div
            role={step === 2 ? "group" : "radiogroup"}
            aria-label={STEPS[step].title}
            className={cn("mt-6 grid gap-2.5", step === 1 ? "sm:grid-cols-3" : "sm:grid-cols-2")}
          >
            {options.map((o) => {
              const on = selected(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role={step === 2 ? undefined : "radio"}
                  aria-checked={step === 2 ? undefined : on}
                  aria-pressed={step === 2 ? on : undefined}
                  onClick={() => pick(o.id)}
                  className={cn(
                    "flex min-h-[64px] items-center gap-3 rounded-2xl border p-4 text-left transition-colors duration-200 active:scale-[0.99]",
                    on
                      ? "border-primary/60 bg-primary/10"
                      : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                      on ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary",
                    )}
                  >
                    <o.icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                  {step === 2 && (
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-white/20",
                      )}
                    >
                      {on && <Check className="size-3.5" />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="mt-8 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(s - 1, 0))}
          disabled={step === 0 || busy !== null}
          className={cn(step === 0 && "invisible")}
        >
          <ArrowLeft className="size-4" /> Back
        </Button>
        {step < 2 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="rounded-full px-6">
            Next <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={!canNext || busy !== null} className="rounded-full px-6">
            {busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Show my plan
          </Button>
        )}
      </div>
    </Shell>
  );
}

function PlanReveal({
  plan,
  goals,
  config,
}: {
  plan: "personal" | "team";
  goals: string[];
  config: { personalPlanPriceUsd: number; teamPlanPriceUsd: number; personalPlanCredits: number; teamPlanCredits: number } | undefined;
}) {
  const reduce = useReducedMotion();
  const copy = PLAN_COPY[plan];
  const other = plan === "personal" ? "team" : "personal";
  const price = config ? (plan === "personal" ? config.personalPlanPriceUsd : config.teamPlanPriceUsd) : null;
  const otherPrice = config ? (other === "personal" ? config.personalPlanPriceUsd : config.teamPlanPriceUsd) : null;
  const credits = config ? (plan === "personal" ? config.personalPlanCredits : config.teamPlanCredits) : null;
  const picked = GOALS.filter((g) => goals.includes(g.id));

  return (
    <Shell glow>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
          Your plan · unlocked
        </span>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {copy.name}{" "}
          <span className="font-display font-normal italic text-primary">fits you best.</span>
        </h1>
        <p className="mt-2 text-muted-foreground">{copy.blurb}</p>

        <div className="mt-6 rounded-2xl border border-primary/40 bg-primary/[0.06] p-5 shadow-[0_0_60px_-24px_oklch(0.598_0.241_294.3/0.8)] sm:p-6">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <motion.span
              className="text-5xl font-semibold tracking-tight"
              initial={reduce ? false : { filter: "blur(14px)", opacity: 0.4, scale: 0.96 }}
              animate={{ filter: "blur(0px)", opacity: 1, scale: 1 }}
              transition={{ duration: 0.9, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              {price === null ? "—" : `$${price}`}
            </motion.span>
            <span className="text-muted-foreground">/mo</span>
            {credits !== null && (
              <span className="ml-auto rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                {credits.toLocaleString("en-US")} credits every month
              </span>
            )}
          </div>

          {picked.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                What you asked for — all included
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {picked.map((g) => (
                  <li key={g.id} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm">
                    <g.icon className="size-3.5 text-primary" /> {g.label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {copy.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <Button asChild size="lg" className="h-12 flex-1 rounded-xl text-base font-semibold">
            <Link href="/settings?tab=billing">
              Start {copy.name} <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 rounded-xl text-base sm:w-auto">
            <Link href="/dashboard">Continue on Free</Link>
          </Button>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground sm:text-left">
          {otherPrice !== null && (
            <>
              {PLAN_COPY[other].name} is ${otherPrice}/mo.{" "}
            </>
          )}
          <Link href="/settings?tab=billing" className="text-foreground underline-offset-4 hover:underline">
            Compare all plans
          </Link>{" "}
          · Cancel any time · Prices in USD
        </p>
      </motion.div>
    </Shell>
  );
}

function Shell({ children, glow = false }: { children: React.ReactNode; glow?: boolean }) {
  return (
    <div className="relative mx-auto flex min-h-[calc(100dvh-10rem)] w-full max-w-2xl items-center py-6">
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-72 transition-opacity duration-700",
          glow ? "opacity-100" : "opacity-60",
        )}
        style={{ background: "radial-gradient(520px 240px at 50% 0%, oklch(0.598 0.241 294.3 / 0.14), transparent 70%)" }}
      />
      <div className="relative w-full rounded-3xl border border-white/10 bg-card/80 p-5 backdrop-blur sm:p-8">
        {children}
      </div>
    </div>
  );
}
