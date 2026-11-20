"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Loader2, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LEGAL_LINKS, TERMS_VERSION } from "@/lib/legal";
import { errorText } from "@/lib/public-errors";
import { hasConvex } from "@/lib/runtime";

/** Set by the sign-up page: this browser just saw the sign-up clickwrap. */
export const SIGNUP_TERMS_KEY = "signup-terms-version";
/** A sign-up flag only counts for accounts created this recently. */
const FRESH_ACCOUNT_MS = 60 * 60 * 1000;

/**
 * Records Terms + Privacy acceptance server-side (users.termsAcceptedAt /
 * termsVersion). A fresh sign-up that saw "By creating an account you
 * agree…" is recorded silently; everyone else — accounts from before the
 * clickwrap, or after a TERMS_VERSION bump — gets a blocking prompt.
 */
export function TermsGate() {
  if (!hasConvex) return null;
  return <TermsGateLive />;
}

function TermsGateLive() {
  const { isAuthenticated } = useConvexAuth();
  const status = useQuery(api.legal.termsStatus, isAuthenticated ? {} : "skip");
  const accept = useMutation(api.legal.acceptTerms);
  const [busy, setBusy] = useState(false);
  const [autoFailed, setAutoFailed] = useState(false);
  const autoTried = useRef(false);
  // Read the clock once on mount; render itself must stay pure.
  const [mountedAt] = useState(() => Date.now());

  const needs = Boolean(status?.needsAcceptance);
  const fromSignup = (() => {
    if (!status || !needs) return false;
    try {
      return (
        sessionStorage.getItem(SIGNUP_TERMS_KEY) === TERMS_VERSION &&
        mountedAt - status.accountCreatedAt < FRESH_ACCOUNT_MS
      );
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    if (!fromSignup || autoTried.current) return;
    autoTried.current = true;
    accept({ version: TERMS_VERSION })
      .then(() => {
        try {
          sessionStorage.removeItem(SIGNUP_TERMS_KEY);
        } catch {
          // ignore
        }
      })
      // Fall back to the explicit prompt.
      .catch(() => setAutoFailed(true));
  }, [fromSignup, accept]);

  const onAccept = async () => {
    setBusy(true);
    try {
      await accept({ version: TERMS_VERSION });
    } catch (e) {
      toast.error(errorText(e, "Couldn't save — try again."));
    } finally {
      setBusy(false);
    }
  };

  if (!status || !needs || (fromSignup && !autoFailed)) return null;

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="size-5 text-primary" />
            {status.acceptedVersion ? "We've updated our terms" : "Please review our terms"}
          </DialogTitle>
          <DialogDescription>
            To keep using your workspace, please review and accept our{" "}
            <Link href={LEGAL_LINKS.terms} target="_blank" className="text-primary underline-offset-4 hover:underline">
              Terms of Service
            </Link>{" "}
            (including the{" "}
            <Link href={LEGAL_LINKS.acceptableUse} target="_blank" className="text-primary underline-offset-4 hover:underline">
              Acceptable Use Policy
            </Link>
            ) and{" "}
            <Link href={LEGAL_LINKS.privacy} target="_blank" className="text-primary underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            . They cover auto-renewal and cancellation, credits, your responsibility for consent when you email,
            call, record or generate content, and binding arbitration.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onAccept} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} I agree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
