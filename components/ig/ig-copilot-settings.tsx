"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Bot, CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { IgAccount } from "./ig-inbox";

function serverMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : "";
  return raw.split("Uncaught Error: ").pop() || fallback;
}

/**
 * Copilot settings: the brief (the only facts the AI may state), the
 * booking link it drives toward, and the autopilot switch. The reply voice
 * itself comes from the Boost My Comments intake — no re-entry here.
 */
export function CopilotSettings({ account }: { account: IgAccount }) {
  const save = useMutation(api.igDms.setCopilotSettings);
  const [open, setOpen] = useState(false);
  const [autopilot, setAutopilot] = useState(account.autopilot);
  const [brief, setBrief] = useState(account.aiBrief);
  const [link, setLink] = useState(account.bookingLink);
  const [saving, setSaving] = useState(false);

  // Fresh copy of the saved settings every time the dialog opens.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setAutopilot(account.autopilot);
      setBrief(account.aiBrief);
      setLink(account.bookingLink);
    }
    setOpen(next);
  };

  const doSave = async () => {
    setSaving(true);
    try {
      await save({ autopilot, aiBrief: brief, bookingLink: link });
      toast.success(
        autopilot
          ? "Autopilot is on — it replies from your brief and hands off anything else."
          : "Copilot settings saved.",
      );
      setOpen(false);
    } catch (e) {
      toast.error(serverMessage(e, "Couldn't save the settings."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Bot className="size-4 text-primary" />
          Copilot
          {account.autopilot && (
            <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              Autopilot on
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>AI copilot</DialogTitle>
          <DialogDescription>
            Drafts every reply in your voice. Flip on autopilot and it answers
            on its own — strictly from the brief below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
            {account.hasVoiceProfile ? (
              <>
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Voice profile loaded
                  </span>{" "}
                  from your Boost My Comments intake — tone, length, emoji
                  level and the examples you love.
                </p>
              </>
            ) : (
              <>
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">
                    No voice profile yet.
                  </span>{" "}
                  Fill in{" "}
                  <Link href="/forms" className="text-primary underline">
                    Boost My Comments
                  </Link>{" "}
                  so replies sound like you — until then the copilot writes
                  warm and neutral.
                </p>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ig-brief">Brief — what the AI may say</Label>
            <Textarea
              id="ig-brief"
              rows={6}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={
                "What you offer, prices you're happy to quote, common questions and answers, how you book calls…\n\nAnything not in here gets handed to you."
              }
            />
            <p className="text-xs text-muted-foreground">
              This is the guardrail: a lead asking for something outside the
              brief pauses autopilot and pings you.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ig-booking">Booking link</Label>
            <Input
              id="ig-booking"
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://cal.com/you/intro"
            />
            <p className="text-xs text-muted-foreground">
              Sent the moment a lead is ready to book.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Autopilot</p>
              <p className="text-xs text-muted-foreground">
                Off = drafts only. On = replies to fresh DMs by itself; every
                AI message is labeled in the thread.
              </p>
            </div>
            <Switch
              checked={autopilot}
              onCheckedChange={setAutopilot}
              disabled={!brief.trim()}
              aria-label="Autopilot"
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={doSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
