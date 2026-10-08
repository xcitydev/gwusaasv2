"use client";

import { useState, useSyncExternalStore } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CREDIT_PACKS, MIN_TOPUP_CREDITS, MAX_TOPUP_CREDITS, quoteTopup } from "@/lib/credit-packs";
import { closeTopUp, getTopUpRequest, subscribeTopUp } from "@/lib/top-up-prompt";
import { cn } from "@/lib/utils";

const n = (v: number) => v.toLocaleString("en-US");

/**
 * The one top-up dialog for the whole app. Mounted once in the shell; opened
 * from Settings or automatically when an action hits a credit shortfall.
 * The server re-quotes before checkout, so prices here are only a preview.
 */
export function TopUpDialogHost() {
  const request = useSyncExternalStore(subscribeTopUp, getTopUpRequest, () => null);
  const whop = useQuery(api.whop.status);
  const startTopup = useAction(api.whopActions.startTopupCheckout);
  const [selected, setSelected] = useState<string>("growth");
  const [custom, setCustom] = useState("");
  const [paying, setPaying] = useState(false);

  const price = whop?.creditPriceUsd ?? 0.01;
  const credits =
    selected === "custom"
      ? Math.max(0, Math.round(Number(custom) || 0))
      : (CREDIT_PACKS.find((p) => p.id === selected)?.credits ?? 0);
  let quote: ReturnType<typeof quoteTopup> | null = null;
  let quoteError: string | null = null;
  try {
    quote = credits > 0 ? quoteTopup(credits, price) : null;
  } catch (e) {
    quoteError = e instanceof Error ? e.message : "Invalid amount";
  }
  const shortfall =
    request?.need !== undefined && request?.have !== undefined
      ? Math.max(0, request.need - request.have)
      : null;

  const pay = async () => {
    if (!quote) return;
    setPaying(true);
    try {
      const { url } = await startTopup({ credits: quote.baseCredits });
      window.location.assign(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("Uncaught Error: ").pop() ?? "" : "";
      toast.error(
        msg.includes("NOT_CONFIGURED")
          ? "Top-ups activate once billing keys are added — contact support meanwhile."
          : msg || "Couldn't open checkout.",
      );
      setPaying(false);
    }
  };

  return (
    <Dialog open={request !== null} onOpenChange={(o) => !o && closeTopUp()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Top up credits</DialogTitle>
          <DialogDescription>
            {shortfall !== null && request ? (
              <>
                {request.context ? `${request.context} needs ` : "This needs "}
                <span className="font-medium text-foreground">{n(request.need!)} credits</span>
                {" "}and you have{" "}
                <span className="font-medium text-foreground">{n(request.have!)}</span>.
                {" "}Add at least {n(Math.max(shortfall, MIN_TOPUP_CREDITS))} to continue.
              </>
            ) : (
              <>1 credit = ${price.toFixed(2)}. Bigger packs include bonus credits. Credits never expire.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Credit pack">
          {CREDIT_PACKS.map((pack) => {
            const q = quoteTopup(pack.credits, price);
            const active = selected === pack.id;
            return (
              <button
                key={pack.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(pack.id)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  active ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
                )}
              >
                <span className="flex w-full items-center justify-between text-sm font-medium">
                  {pack.name}
                  {active && <Check className="size-4 text-primary" />}
                </span>
                <span className="text-lg font-semibold tabular-nums">${q.usd.toFixed(0)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {n(pack.credits)} credits
                  {q.bonusCredits > 0 && (
                    <span className="text-primary"> + {n(q.bonusCredits)} bonus</span>
                  )}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={selected === "custom"}
            onClick={() => setSelected("custom")}
            className={cn(
              "col-span-2 flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
              selected === "custom" ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
            )}
          >
            <span className="text-sm font-medium">Custom</span>
            <Input
              inputMode="numeric"
              value={custom}
              onChange={(e) => {
                setSelected("custom");
                setCustom(e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder={`${n(MIN_TOPUP_CREDITS)} to ${n(MAX_TOPUP_CREDITS)}`}
              aria-label="Custom credit amount"
              className="h-8 max-w-[200px]"
            />
            <span className="ml-auto text-xs text-muted-foreground">no bonus</span>
          </button>
        </div>

        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {quoteError
            ? quoteError
            : quote
              ? `You pay $${quote.usd.toFixed(2)} and receive ${n(quote.totalCredits)} credits${whop?.sandbox ? " · sandbox mode" : ""}.`
              : "Choose a pack or enter an amount."}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={closeTopUp}>Not now</Button>
          <Button onClick={pay} disabled={paying || !quote}>
            {paying && <Loader2 className="size-4 animate-spin" />}
            Continue to payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
