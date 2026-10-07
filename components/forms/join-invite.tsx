"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ArrowRight, ClipboardList, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { formatInviteCode, INVITE_STORAGE_KEY, normalizeInviteCode } from "@/lib/invite-codes";
import { isConfigured } from "@/lib/runtime";

const STEPS = [
  "Create your account — or sign in if you already have one",
  "Your Creatily Onboarding Forms unlock automatically",
  "Tell us about your business and we take it from there",
];

const DEAD: Record<"invalid" | "expired" | "used", { title: string; body: string }> = {
  invalid: {
    title: "This invite link isn't active",
    body: "It may have been mistyped or switched off. Ask whoever sent it for a fresh link.",
  },
  expired: {
    title: "This invite link has expired",
    body: "Ask whoever sent it for a new link — it only takes them a second.",
  },
  used: {
    title: "This invite link has been used up",
    body: "It has reached its sign-up limit. Ask whoever sent it for a new link.",
  },
};

/** Wraps the live flow so setup mode (no Clerk/Convex) never mounts its hooks. */
export function JoinInvite({ code }: { code: string }) {
  return (
    <Frame>
      {isConfigured ? (
        <LiveJoin code={code} />
      ) : (
        <p className="text-sm text-muted-foreground">Invites work once Clerk and Convex are connected.</p>
      )}
    </Frame>
  );
}

function LiveJoin({ code }: { code: string }) {
  const router = useRouter();
  const lookup = useQuery(api.inviteCodes.lookup, { code });
  const { isAuthenticated, isLoading } = useConvexAuth();
  const redeem = useMutation(api.inviteCodes.redeem);
  const [busy, setBusy] = useState(false);

  // Hold the code until the account exists; EnsureUser redeems it after
  // sign-up or sign-in and sends them to /forms.
  useEffect(() => {
    if (lookup?.status !== "valid") return;
    try {
      localStorage.setItem(INVITE_STORAGE_KEY, code);
    } catch {
      // Storage unavailable — they can still enter the code in Settings.
    }
  }, [lookup?.status, code]);

  const unlockNow = async () => {
    setBusy(true);
    try {
      const result = await redeem({ code });
      toast.success(
        result.status === "unlocked"
          ? "Invite accepted — Creatily Onboarding Forms are unlocked."
          : "You already have access to the onboarding forms.",
      );
      try {
        localStorage.removeItem(INVITE_STORAGE_KEY);
      } catch {
        // ignore
      }
      router.push("/forms");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That invite code is not valid.");
      setBusy(false);
    }
  };

  if (lookup === undefined || isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-primary" aria-label="Checking your invite" />
      </div>
    );
  }

  if (lookup.status !== "valid") {
    const dead = DEAD[lookup.status];
    return (
      <div className="text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-white/5 text-muted-foreground">
          <ShieldAlert className="size-6" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{dead.title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{dead.body}</p>
        <Button asChild variant="outline" className="mt-7 rounded-full">
          <Link href="/">Go to the homepage</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
        <span className="size-1.5 rounded-full bg-primary" /> Private invite
      </span>
      <h1 className="mt-5 text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
        You&apos;re invited to{" "}
        <span className="font-display font-normal italic text-primary">Creatily Onboarding Forms.</span>
      </h1>
      <p className="mt-3 text-muted-foreground">
        Your done-for-you onboarding starts here. This link unlocks the forms on your account.
      </p>

      <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <KeyRound className="size-4 shrink-0 text-primary" />
        <span className="text-xs text-muted-foreground">Invite code</span>
        <span className="ml-auto font-mono text-sm tracking-wider">
          {formatInviteCode(normalizeInviteCode(code))}
        </span>
      </div>

      <ol className="mt-6 space-y-3">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-start gap-3 text-sm">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-sm italic text-primary">
              {i + 1}
            </span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-col gap-2.5">
        {isAuthenticated ? (
          <Button onClick={unlockNow} disabled={busy} size="lg" className="h-12 rounded-xl text-base font-semibold">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ClipboardList className="size-4" />}
            Unlock my forms
          </Button>
        ) : (
          <>
            <Button asChild size="lg" className="h-12 rounded-xl text-base font-semibold">
              <Link href="/sign-up">
                Create my account <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 rounded-xl text-base">
              <Link href="/sign-in">I already have an account — sign in</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(640px 320px at 50% 0%, oklch(0.598 0.241 294.3 / 0.14), transparent 70%)" }}
      />
      <Link href="/" className="relative z-10 mb-8 flex items-center gap-2.5">
        <Image src={BRAND.logo.wordmark} alt={BRAND.name} width={867} height={192} className="h-8 w-auto" priority />
      </Link>
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-card/80 p-6 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] backdrop-blur sm:p-8"
      >
        {children}
      </motion.div>
    </main>
  );
}
