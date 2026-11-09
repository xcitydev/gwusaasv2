"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CalendarCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { friendlyError } from "./shared";
import { AutoJoinPicker } from "./auto-join-picker";
import type { AutoJoinMode } from "@/lib/note-taker";

/**
 * Second half of the calendar connect: an explicit, signed-in confirmation.
 * The server only attaches the calendar if this account started the flow.
 */
export function CalendarConnectConfirm({ nonce }: { nonce: string }) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const confirm = useAction(api.noteTakerActions.confirmCalendarConnect);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoJoin, setAutoJoin] = useState<AutoJoinMode>("hosting");

  const doConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const { email } = await confirm({ nonce, autoJoin });
      toast.success(email ? `Connected ${email}.` : "Calendar connected.");
      router.replace("/note-taker");
    } catch (e) {
      setError(friendlyError(e, "Couldn't connect that calendar."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto mt-10 max-w-md border-white/10">
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <CalendarCheck className="size-8 text-primary" />
        <div className="space-y-1">
          <p className="font-medium">Finish connecting your calendar</p>
          <p className="text-sm text-muted-foreground">
            The note taker will read this calendar&apos;s events so it can join
            your meetings. Only confirm if you just started this connection
            yourself.
          </p>
        </div>
        {!nonce ? (
          <p className="text-sm text-amber-400">
            This link is incomplete — start the connection again from the Note
            Taker settings.
          </p>
        ) : (
          <div className="w-full space-y-2 text-left">
            <p className="text-sm font-medium">Which meetings should it join on its own?</p>
            <AutoJoinPicker value={autoJoin} onChange={setAutoJoin} />
          </div>
        )}
        {nonce && (
          <Button
            onClick={() => void doConfirm()}
            disabled={busy || isLoading || !isAuthenticated}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Connect calendar
          </Button>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </CardContent>
    </Card>
  );
}
