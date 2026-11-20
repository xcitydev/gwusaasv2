"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { CalendarCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { friendlyError, type Overview } from "./shared";

/**
 * "Connect your calendar" — shown until one is connected. This is what makes
 * the note taker automatic: after connecting, the bot joins the meetings you
 * host (or whatever auto-join mode you pick on the confirm screen).
 */
export function ConnectCalendarCard({
  overview,
  highlight = false,
}: {
  overview: Overview;
  highlight?: boolean;
}) {
  const connectUrl = useAction(api.noteTakerActions.calendarConnectUrl);
  const [busy, setBusy] = useState<string | null>(null);

  const connect = async (provider: "google" | "microsoft") => {
    setBusy(provider);
    try {
      const { url } = await connectUrl({ provider });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't start the calendar connection."));
    } finally {
      setBusy(null);
    }
  };

  const anyProvider =
    overview.calendarProviders.google || overview.calendarProviders.microsoft;

  return (
    <Card
      className={cn(
        "border-primary/20 bg-gradient-to-r from-primary/10 to-transparent",
        highlight && "ring-2 ring-primary/50",
      )}
      data-tour="notetaker-connect-calendar"
    >
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <CalendarCheck className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-medium">Let the note taker join on its own</p>
          <p className="text-sm text-muted-foreground">
            Connect your calendar and it joins the meetings you host
            automatically — no links to paste. You can switch any meeting off.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {(
            [
              ["google", "Google"],
              ["microsoft", "Outlook"],
            ] as const
          ).map(([provider, label]) => (
            <Button
              key={provider}
              variant={provider === "google" ? "default" : "outline"}
              disabled={
                busy !== null || !overview.configured || !overview.calendarProviders[provider]
              }
              title={
                overview.calendarProviders[provider] ? undefined : "Not set up on the platform yet"
              }
              onClick={() => void connect(provider)}
            >
              {busy === provider && <Loader2 className="size-4 animate-spin" />}
              {label}
            </Button>
          ))}
        </div>
        {!anyProvider && overview.isAdmin && (
          <p className="text-xs text-amber-400 sm:hidden">
            Admin: set GOOGLE_OAUTH_CLIENT_ID/SECRET or MS_OAUTH_CLIENT_ID/SECRET.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
