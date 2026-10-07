"use client";

import Link from "next/link";
import { KeyRound, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePendingInvite } from "./use-pending-invite";

type Mode = "sign-up" | "sign-in";

/** Progress steps + headline above the Clerk form; adapts to a pending invite. */
export function AuthIntro({ mode }: { mode: Mode }) {
  const invite = usePendingInvite();

  const steps =
    mode === "sign-in"
      ? null
      : invite
        ? ["Account", "Forms unlock", "Your business"]
        : ["Account", "3 quick questions", "Your plan"];

  const copy =
    mode === "sign-up"
      ? invite
        ? { lead: "Welcome aboard.", accent: "Let's get you set up.", sub: "Create your account and your onboarding forms open right away." }
        : { lead: "Create your account.", accent: "Your team is waiting.", sub: "Free plan · no card required · takes under a minute." }
      : invite
        ? { lead: "Welcome back.", accent: "Your invite carries over.", sub: "Sign in and your onboarding forms unlock automatically." }
        : { lead: "Welcome back.", accent: "Pick up where you left off.", sub: "Sign in to your Creatily workspace." };

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      {steps && (
        <ol className="grid grid-cols-3 gap-2" aria-label="Sign-up steps">
          {steps.map((s, i) => (
            <li key={s} className="flex flex-col gap-2" aria-current={i === 0 ? "step" : undefined}>
              <span className={cn("h-[3px] rounded-full", i === 0 ? "bg-primary" : "bg-white/12")} />
              <span className={cn("text-xs", i === 0 ? "font-semibold" : "text-muted-foreground")}>
                {i + 1} · {s}
              </span>
            </li>
          ))}
        </ol>
      )}

      {invite ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/35 bg-primary/[0.08] px-4 py-3">
          <span className="flex items-center gap-2.5 text-sm font-semibold">
            <KeyRound className="size-4 text-primary" /> Invite applied
          </span>
          <span className="font-mono text-sm tracking-wider text-primary">{invite}</span>
        </div>
      ) : (
        mode === "sign-up" && (
          <span className="hidden text-xs font-bold uppercase tracking-[0.24em] text-primary sm:inline">Start free</span>
        )
      )}

      <div>
        <h1 className="text-balance text-3xl font-semibold leading-[1.08] tracking-tight sm:text-[2.5rem]">
          {copy.lead}{" "}
          <span className="font-display font-normal italic text-primary">{copy.accent}</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-[15px]">{copy.sub}</p>
      </div>
    </div>
  );
}

/** Reassurance row under the sign-up form. */
export function AuthTrust() {
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t border-white/[0.07] pt-5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Lock className="size-3" /> Encrypted sign-in
      </span>
      <span>No card required</span>
      <span>Cancel any time</span>
    </p>
  );
}

/** Clerk's own footer is hidden globally (white-label), so we link between the two forms ourselves. */
export function AuthSwitch({ mode }: { mode: Mode }) {
  return (
    <p className="text-center text-sm text-muted-foreground">
      {mode === "sign-up" ? "Already have an account? " : "New to Creatily? "}
      <Link
        href={mode === "sign-up" ? "/sign-in" : "/sign-up"}
        className="font-semibold text-primary underline-offset-4 hover:underline"
      >
        {mode === "sign-up" ? "Sign in" : "Create a free account"}
      </Link>
    </p>
  );
}
