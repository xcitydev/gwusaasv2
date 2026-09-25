"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { KeyRound, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { isConfigured } from "@/lib/runtime";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";

/** Code input + Unlock button; shared by the gate page and Settings. */
export function InviteCodeForm({ autoFocus }: { autoFocus?: boolean }) {
  const redeem = useMutation(api.inviteCodes.redeem);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim()) {
      toast.error("Enter your invite code first.");
      return;
    }
    setBusy(true);
    try {
      const result = await redeem({ code });
      toast.success(
        result.status === "already"
          ? "You already have access to the forms."
          : "Invite accepted — GWU Onboarding Forms are unlocked.",
      );
      setCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That invite code is not valid.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="GWU-XXXX-XXXX"
        autoFocus={autoFocus}
        autoCapitalize="characters"
        spellCheck={false}
        className="font-mono uppercase tracking-wider"
        aria-label="Invite code"
      />
      <Button type="submit" disabled={busy} className="shrink-0">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        Unlock
      </Button>
    </form>
  );
}

/** Settings card: shows access status, or the redeem form. */
export function InviteCodeCard() {
  const me = useQuery(api.users.me, isConfigured ? {} : "skip");
  const unlocked = Boolean(me?.formsAccess);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-primary" /> GWU Onboarding Forms
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isConfigured ? (
          <p className="text-sm text-muted-foreground">
            Invite codes work once Clerk and Convex keys are added.
          </p>
        ) : me === undefined ? (
          <Skeleton className="h-9 w-72" />
        ) : unlocked ? (
          <p className="text-sm text-muted-foreground">
            Unlocked
            {me?.formsAccessSource === "invite"
              ? " with an invite code"
              : me?.formsAccessSource === "admin"
                ? " by the GWU team"
                : ""}
            . Find the forms under{" "}
            <Link href="/forms" className="text-primary underline">
              GWU Onboarding Forms
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              The done-for-you service forms are invite-only. Enter the code the
              GWU team gave you to unlock them.
            </p>
            <InviteCodeForm />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Wraps the /forms routes: skeleton → invite prompt → the page. */
export function FormsGate({ children }: { children: ReactNode }) {
  if (!isConfigured) return <>{children}</>;
  return <LiveGate>{children}</LiveGate>;
}

function LiveGate({ children }: { children: ReactNode }) {
  const me = useQuery(api.users.me);
  if (me === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (me?.formsAccess) return <>{children}</>;
  return (
    <div>
      <PageHeader
        title="GWU Onboarding Forms"
        description="Done-for-you service requests, available by invitation."
      />
      <div className="flex justify-center py-8">
        <Card className="w-full max-w-md border-primary/30">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <LockKeyhole className="size-6" />
            </span>
            <div>
              <p className="font-medium">Invite only</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter the invite code you received from the GWU team to unlock
                the onboarding forms. You can also add it later in Settings.
              </p>
            </div>
            <InviteCodeForm autoFocus />
            <p className="text-xs text-muted-foreground">
              No code yet?{" "}
              <Link href="/support" className="text-primary underline">
                Contact the team
              </Link>{" "}
              and we can enable access for you.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
