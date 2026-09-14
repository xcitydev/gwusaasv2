"use client";

import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ListSkeleton } from "@/components/list-skeleton";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  ChevronDown,
  Flame,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  ShoppingCart,
  Trash2,
  Upload,
} from "lucide-react";
import { downloadCsv, parseCsv, toCsv } from "@/lib/csv";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const IMAP_CSV_COLUMNS = [
  "email", "imap_host", "imap_port", "imap_username", "imap_password",
  "smtp_host", "smtp_port", "smtp_username", "smtp_password", "daily_limit",
];

export function InboxesTab() {
  const inboxesQuery = useQuery(api.outreach.listInboxes);
  const inboxes = inboxesQuery ?? [];
  const connectInboxes = useAction(api.outreachActions.connectInboxes);
  const removeInbox = useMutation(api.outreach.removeInbox);
  const toggleWarmup = useAction(api.outreachActions.toggleWarmup);
  const syncNow = useAction(api.outreachActions.syncNow);
  const [syncing, setSyncing] = useState(false);

  const [dialog, setDialog] = useState<null | "oauth" | "imap" | "prewarmed">(null);
  const [oauthProvider, setOauthProvider] = useState<"google" | "outlook">("google");
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: Id<"inboxes">; email: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // IMAP/SMTP form state
  const [imapForm, setImapForm] = useState({
    email: "", imapHost: "", imapPort: "993", imapUser: "", imapPass: "",
    smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", dailyLimit: "30",
  });
  const [oauthEmail, setOauthEmail] = useState("");

  const connectOauth = async () => {
    if (!/^\S+@\S+\.\S+$/.test(oauthEmail)) {
      toast.error("Enter the inbox email address.");
      return;
    }
    setBusy(true);
    try {
      await connectInboxes({
        inboxes: [{ email: oauthEmail, provider: oauthProvider, dailyLimit: 30 }],
      });
      toast.success(`${oauthEmail} connected — warmup starts automatically.`);
      setDialog(null);
      setOauthEmail("");
    } catch {
      toast.error("Connection failed. Are you signed in?");
    } finally {
      setBusy(false);
    }
  };

  const connectImap = async () => {
    const f = imapForm;
    if (!/^\S+@\S+\.\S+$/.test(f.email) || !f.imapHost || !f.smtpHost || !f.imapPass) {
      toast.error("Email, IMAP host, SMTP host and password are required.");
      return;
    }
    setBusy(true);
    try {
      const result = await connectInboxes({
        inboxes: [
          {
            email: f.email,
            provider: "imap_smtp",
            dailyLimit: Number(f.dailyLimit) || 30,
            imap: { host: f.imapHost, port: f.imapPort, username: f.imapUser || f.email, password: f.imapPass },
            smtp: { host: f.smtpHost, port: f.smtpPort, username: f.smtpUser || f.email, password: f.smtpPass || f.imapPass },
          },
        ],
      });
      if (result.engineErrors.length > 0) {
        toast.warning(`Saved, but the email engine rejected it: ${result.engineErrors[0]}`, {
          duration: 10000,
        });
      } else {
        toast.success(`${f.email} connected — credentials stored encrypted.`);
      }
      setDialog(null);
    } catch {
      toast.error("Connection failed. Are you signed in?");
    } finally {
      setBusy(false);
    }
  };

  const handleBulkCsv = async (file: File) => {
    setBusy(true);
    try {
      const { headers, rows } = parseCsv(await file.text());
      const col = (row: string[], name: string) => {
        const idx = headers.indexOf(name);
        return idx === -1 ? "" : (row[idx]?.trim() ?? "");
      };
      const inboxes = rows
        .filter((row) => col(row, "email").includes("@"))
        .map((row) => ({
          email: col(row, "email"),
          provider: "imap_smtp" as const,
          dailyLimit: Number(col(row, "daily_limit")) || 30,
          imap: {
            host: col(row, "imap_host"),
            port: col(row, "imap_port") || "993",
            username: col(row, "imap_username") || col(row, "email"),
            password: col(row, "imap_password"),
          },
          smtp: {
            host: col(row, "smtp_host"),
            port: col(row, "smtp_port") || "587",
            username: col(row, "smtp_username") || col(row, "email"),
            password: col(row, "smtp_password"),
          },
        }));
      if (inboxes.length === 0) {
        toast.error("No valid rows — download the sample CSV for the format.");
        return;
      }
      const { added, skipped } = await connectInboxes({ inboxes });
      toast.success(
        `Imported ${added} inbox${added === 1 ? "" : "es"}` +
          (skipped > 0 ? ` — ${skipped} skipped (duplicates)` : ""),
      );
    } catch {
      toast.error("Couldn't read that CSV file.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadSample = () => {
    downloadCsv(
      "inboxes-sample.csv",
      toCsv(IMAP_CSV_COLUMNS, [
        ["outreach@mybrand.com", "imap.hostinger.com", "993", "outreach@mybrand.com", "imap-password", "smtp.hostinger.com", "587", "outreach@mybrand.com", "smtp-password", "30"],
      ]),
    );
  };

  const setField = (key: keyof typeof imapForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setImapForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {inboxes.length} inbox{inboxes.length === 1 ? "" : "es"} ·{" "}
          {inboxes.filter((i) => i.status === "warmed").length} warmed
        </p>
        <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={syncing}
          onClick={async () => {
            setSyncing(true);
            try {
              const { configured } = await syncNow();
              toast.success(
                configured
                  ? "Synced with the email engine — health and replies updated."
                  : "Email engine not connected yet — nothing to sync.",
              );
            } catch {
              toast.error("Sync failed — try again in a moment.");
            } finally {
              setSyncing(false);
            }
          }}
        >
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Sync
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <Mail className="size-4" /> Add inboxes <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setDialog("prewarmed")}>
              <ShoppingCart className="size-4" /> Buy prewarmed domains
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setOauthProvider("google"); setDialog("oauth"); }}>
              <Mail className="size-4" /> Connect Gmail / GSuite
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setOauthProvider("outlook"); setDialog("oauth"); }}>
              <Mail className="size-4" /> Connect Outlook
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialog("imap")}>
              <Inbox className="size-4" /> Any provider (IMAP/SMTP)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> Bulk import (CSV)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={downloadSample}>
              Download sample CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleBulkCsv(e.target.files[0])}
        />
      </div>

      {inboxesQuery === undefined ? (
        <ListSkeleton rows={4} />
      ) : inboxes.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Flame className="size-8 text-muted-foreground" />
            <p className="font-medium">No inboxes yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Buy prewarmed domains from us, connect your Gmail/Outlook, or bulk
              import IMAP/SMTP accounts. Campaigns send only from warmed inboxes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Warmup sent</TableHead>
                  <TableHead>Daily limit</TableHead>
                  <TableHead>Warmup</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {inboxes.map((inbox) => {
                  const warmupOn = inbox.warmupEnabled ?? true;
                  return (
                    <TableRow key={inbox._id}>
                      <TableCell className="font-medium">{inbox.email}</TableCell>
                      <TableCell className="capitalize">
                        {inbox.provider.replace("_", "/")}
                      </TableCell>
                      <TableCell>
                        {inbox.lastEngineError ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span><StatusBadge status={inbox.status} /></span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-64">
                              {inbox.lastEngineError}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <StatusBadge status={inbox.status} />
                        )}
                      </TableCell>
                      <TableCell>
                        {inbox.healthScore != null ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className={cn(
                                  "font-mono text-sm",
                                  inbox.healthScore >= 80
                                    ? "text-emerald-400"
                                    : inbox.healthScore >= 50
                                      ? "text-primary"
                                      : (inbox.warmupSentTotal ?? 0) < 30
                                        ? "text-muted-foreground"
                                        : "text-destructive",
                                )}
                              >
                                {inbox.healthScore}%
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-56">
                              {(inbox.warmupSentTotal ?? 0) < 30 && inbox.healthScore < 80
                                ? "Instantly's warmup score — it stays low until enough warmup emails have gone out. Matches their dashboard."
                                : "Warmup health score, synced from Instantly."}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-muted-foreground">—</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Health scores sync from the warmup engine once
                              it&apos;s connected.
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>
                        {inbox.warmupSentTotal != null ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="font-mono text-sm">
                                {inbox.warmupSentLastDay ?? 0}
                                <span className="text-muted-foreground"> · {inbox.warmupSentTotal} total</span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {inbox.warmupSentLastDay ?? 0} warmup email
                              {(inbox.warmupSentLastDay ?? 0) === 1 ? "" : "s"} sent on the
                              latest day · {inbox.warmupSentTotal} all-time
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{inbox.dailyLimit}/day</TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={
                                warmupOn
                                  ? `Stop warmup for ${inbox.email}`
                                  : `Start warmup for ${inbox.email}`
                              }
                              onClick={async () => {
                                const result = await toggleWarmup({ id: inbox._id });
                                if (result.engineSynced) {
                                  toast.success(
                                    result.next
                                      ? `Warmup running for ${inbox.email} — confirmed by the email engine.`
                                      : `Warmup paused for ${inbox.email} — confirmed by the email engine.`,
                                  );
                                } else if (result.engineError === "account_not_registered") {
                                  toast.warning(
                                    "Saved locally, but this inbox isn't registered in the email engine yet — press Sync to register it.",
                                  );
                                } else if (result.engineError === "not_configured") {
                                  toast.success(
                                    result.next
                                      ? `Warmup will start for ${inbox.email} once the email engine is connected.`
                                      : `Warmup paused for ${inbox.email}.`,
                                  );
                                } else {
                                  toast.warning(
                                    "Saved locally, but the email engine rejected the change — check admin logs.",
                                  );
                                }
                              }}
                            >
                              <Flame
                                className={cn(
                                  "size-4.5 transition-colors",
                                  !warmupOn
                                    ? "text-muted-foreground/50"
                                    : inbox.engineWarmupActive === false
                                      ? "fill-amber-500/25 text-amber-500"
                                      : "fill-red-500/25 text-red-500",
                                )}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-56">
                            {warmupOn ? "Warmup active — click to stop" : "Warmup paused — click to start"}
                            {inbox.engineWarmupActive != null && (
                              <span className="mt-1 block text-[11px] opacity-80">
                                {inbox.engineWarmupActive
                                  ? "✓ Confirmed running by the email engine"
                                  : warmupOn
                                    ? "Engine hasn't confirmed yet — press Sync"
                                    : "Confirmed paused by the email engine"}
                              </span>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${inbox.email}`}
                          onClick={() => setRemoveTarget({ id: inbox._id, email: inbox.email })}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Buy prewarmed */}
      <Dialog open={dialog === "prewarmed"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buy prewarmed domains</DialogTitle>
            <DialogDescription>
              Ready-to-send domains with warmed inboxes, live within 24 hours of
              purchase. Billing for domains and inboxes is handled separately
              from credits.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm text-muted-foreground">
            Prewarmed inventory goes live once the email engine is connected
            (admin → Infrastructure). Until then, connect your own inboxes below
            — everything else works the same.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OAuth connect */}
      <Dialog open={dialog === "oauth"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Connect {oauthProvider === "google" ? "Gmail / GSuite" : "Outlook"}
            </DialogTitle>
            <DialogDescription>
              Enter the inbox address — you&apos;ll authorize it with{" "}
              {oauthProvider === "google" ? "Google" : "Microsoft"} and warmup
              starts automatically.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="you@yourdomain.com"
            type="email"
            value={oauthEmail}
            onChange={(e) => setOauthEmail(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={connectOauth} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* IMAP/SMTP connect */}
      <Dialog open={dialog === "imap"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect any provider (IMAP/SMTP)</DialogTitle>
            <DialogDescription>
              Credentials are encrypted before they&apos;re stored.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="mb-1.5">Email address *</Label>
              <Input placeholder="you@yourdomain.com" value={imapForm.email} onChange={setField("email")} />
            </div>
            <div>
              <Label className="mb-1.5">IMAP host *</Label>
              <Input placeholder="imap.provider.com" value={imapForm.imapHost} onChange={setField("imapHost")} />
            </div>
            <div>
              <Label className="mb-1.5">IMAP port</Label>
              <Input value={imapForm.imapPort} onChange={setField("imapPort")} />
            </div>
            <div>
              <Label className="mb-1.5">IMAP password *</Label>
              <Input type="password" value={imapForm.imapPass} onChange={setField("imapPass")} />
            </div>
            <div>
              <Label className="mb-1.5">Daily limit</Label>
              <Input inputMode="numeric" value={imapForm.dailyLimit} onChange={setField("dailyLimit")} />
            </div>
            <div>
              <Label className="mb-1.5">SMTP host *</Label>
              <Input placeholder="smtp.provider.com" value={imapForm.smtpHost} onChange={setField("smtpHost")} />
            </div>
            <div>
              <Label className="mb-1.5">SMTP port</Label>
              <Input value={imapForm.smtpPort} onChange={setField("smtpPort")} />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1.5">SMTP password (if different)</Label>
              <Input type="password" value={imapForm.smtpPass} onChange={setField("smtpPass")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={connectImap} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Connect inbox
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeTarget !== null} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Active campaigns using this inbox will stop sending from it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (removeTarget) await removeInbox({ id: removeTarget.id });
                setRemoveTarget(null);
                toast.success("Inbox removed.");
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
