"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasConvex } from "@/lib/runtime";
import { LEGAL } from "@/lib/legal";

/**
 * Public "remove me from your lead data" form. No sign-in; the mutation
 * validates, rate-limits per day, deletes matching lead-library rows and
 * suppresses the email platform-wide.
 */
export function OptOutForm() {
  if (!hasConvex) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-muted-foreground">
        The opt-out form is unavailable right now. Email{" "}
        <a className="text-primary" href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a> and we will
        process your request.
      </p>
    );
  }
  return <OptOutFormLive />;
}

function OptOutFormLive() {
  const submit = useMutation(api.optOuts.submit);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [igHandle, setIgHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() && !phone.trim() && !igHandle.trim()) {
      setError("Enter an email, phone number or Instagram handle.");
      return;
    }
    setBusy(true);
    try {
      const result = await submit({
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        igHandle: igHandle.trim() || undefined,
      });
      if (result.ok) setDone(true);
      else setError(result.error);
    } catch {
      setError(`Something went wrong. Please email ${LEGAL.privacyEmail} instead.`);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" />
        <p>
          Done. Your details have been removed from our lead library and won&apos;t be added again. If you gave an
          email, it is now blocked from all campaigns sent through our platform.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
      <div>
        <Label htmlFor="optout-email" className="mb-1.5">Email address</Label>
        <Input
          id="optout-email"
          type="email"
          autoComplete="email"
          maxLength={254}
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="optout-phone" className="mb-1.5">Phone number (optional)</Label>
          <Input
            id="optout-phone"
            type="tel"
            autoComplete="tel"
            maxLength={32}
            placeholder="+1 555 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="optout-ig" className="mb-1.5">Instagram handle (optional)</Label>
          <Input
            id="optout-ig"
            maxLength={31}
            placeholder="@yourhandle"
            value={igHandle}
            onChange={(e) => setIgHandle(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />} Remove me
      </Button>
    </form>
  );
}
