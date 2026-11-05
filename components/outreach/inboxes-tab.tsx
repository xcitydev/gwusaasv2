"use client";

import { useEffect, useRef, useState } from "react";
import { hasConvex } from "@/lib/runtime";
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

/** Setup mode (no Convex provider): connecting inboxes needs Convex. */
export function InboxesTab() {
  if (!hasConvex) {
    return (
      <Card className="border-white/10">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Inbox className="size-8 text-muted-foreground" />
          <p className="font-medium">No inboxes connected yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Connecting sending inboxes needs Convex — preview-only until it is connected.
          </p>
        </CardContent>
      </Card>
    );
  }
  return <InboxesTabLive />;
}

function InboxesTabLive() {
  const inboxesQuery = useQuery(api.outreach.listInboxes);
  const inboxes = inboxesQuery ?? [];
  const connectInboxes = useAction(api.outreachActions.connectInboxes);
  const removeInbox = useMutation(api.outreach.removeInbox);
  const toggleWarmup = useAction(api.outreachActions.toggleWarmup);
  const syncNow = useAction(api.outreachActions.syncNow);
  // Sync runs the platform-wide engine, so it is an admin-only control.
  const me = useQuery(api.users.me);
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
  const [appPassword, setAppPassword] = useState("");
  // Sign in with Google/Microsoft: the session we are polling, if any.
  const [signIn, setSignIn] = useState<{ sessionId: string; authUrl: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const startSignIn = useAction(api.outreachActions.startMailboxSignIn);
  const checkSignIn = useAction(api.outreachActions.checkMailboxSignIn);
  const detectProvider = useAction(api.outreachActions.detectMailProvider);
  const popupRef = useRef<Window | null>(null);

  // A personal Gmail address can't use Google sign-in (Workspace only), so
  // it connects over IMAP/SMTP with an app password instead.
  const isPersonalGmail = /@(gmail|googlemail)\.com$/i.test(oauthEmail.trim());
  const useAppPassword = oauthProvider === "google" && isPersonalGmail;

  const closeOauthDialog = () => {
    setDialog(null);
    setSignIn(null);
    setAppPassword("");
    popupRef.current?.close();
  };

  // Poll the sign-in while the dialog waits on it.
  useEffect(() => {
    if (!signIn || dialog !== "oauth") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      try {
        const result = await checkSignIn({ sessionId: signIn.sessionId });
        if (stopped) return;
        if (result.status === "pending") {
          timer = setTimeout(tick, 3000);
          return;
        }
        popupRef.current?.close();
        setSignIn(null);
        if (result.status === "connected") {
          toast.success(`${result.email} connected — warmup starts automatically.`);
          setDialog(null);
        } else {
          toast.error(result.message, { duration: 10000 });
        }
      } catch {
        if (!stopped) timer = setTimeout(tick, 5000);
      }
    };
    timer = setTimeout(tick, 3000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [signIn, dialog, checkSignIn]);

  const beginSignIn = async () => {
    // Open the window inside the click so popup blockers allow it, then
    // point it at the provider once the session exists.
    const popup = window.open("about:blank", "mailbox-sign-in", "width=520,height=700");
    popupRef.current = popup;
    setBusy(true);
    try {
      const session = await startSignIn({ provider: oauthProvider });
      if (popup && !popup.closed) popup.location.href = session.authUrl;
      setSignIn(session);
    } catch (error) {
      popup?.close();
      toast.error(error instanceof Error ? error.message : "Couldn't start the sign-in.");
    } finally {
      setBusy(false);
    }
  };

  const connectGmailAppPassword = async () => {
    const email = oauthEmail.trim();
    const password = appPassword.replace(/\s+/g, "");
    if (password.length < 16) {
      toast.error("Paste the 16-character app password from Google.");
      return;
    }
    setBusy(true);
    try {
      const result = await connectInboxes({
        inboxes: [
          {
            email,
            provider: "imap_smtp",
            dailyLimit: 30,
            imap: { host: "imap.gmail.com", port: "993", username: email, password },
            smtp: { host: "smtp.gmail.com", port: "587", username: email, password },
          },
        ],
      });
      if (result.engineErrors.length > 0) {
        toast.error(result.engineErrors[0], { duration: 10000 });
        return;
      }
      toast.success(`${email} connected — warmup starts automatically.`);
      closeOauthDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  };

  /** One click for the address the user signed in to the platform with. */
  const connectAccountEmail = async (email: string) => {
    setDetecting(true);
    try {
      const { kind } = await detectProvider({ email });
      if (kind === "imap") {
        setImapForm((prev) => ({ ...prev, email }));
        setDialog("imap");
      } else {
        setOauthProvider(kind === "outlook" ? "outlook" : "google");
        setOauthEmail(email);
        setDialog("oauth");
      }
    } catch {
      toast.error("Couldn't check that address. Try Add inboxes instead.");
    } finally {
      setDetecting(false);
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

  const accountEmail = me?.email?.trim().toLowerCase() || null;
  const accountEmailConnected =
    inboxesQuery === undefined || inboxes.some((i) => i.email === accountEmail);

  return (
    <div>
      {accountEmail && !accountEmailConnected && (
        <Card className="mb-4 border-white/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="font-medium">Send from {accountEmail}</p>
              <p className="text-sm text-muted-foreground">
                The email you signed in with. Connect it in a couple of clicks.
              </p>
            </div>
            <Button onClick={() => connectAccountEmail(accountEmail)} disabled={detecting}>
              {detecting ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              Connect this email
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {inboxes.length} inbox{inboxes.length === 1 ? "" : "es"} ·{" "}
          {inboxes.filter((i) => i.status === "warmed").length} warmed
        </p>
        <div className="flex items-center gap-2">
        {me?.adminRole && (
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
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button data-tour="outreach-add-inboxes">
              <Mail className="size-4" /> Add inboxes <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setDialog("prewarmed")}>
              <ShoppingCart className="size-4" /> Buy prewarmed domains
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setOauthProvider("google"); setOauthEmail(""); setDialog("oauth"); }}>
              <Mail className="size-4" /> Connect Gmail / GSuite
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setOauthProvider("outlook"); setOauthEmail(""); setDialog("oauth"); }}>
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
        <Card className="border-white/10">
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
                                ? "Warmup score — it stays low until enough warmup emails have gone out."
                                : "Warmup health score, synced from the email engine."}
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
      <Dialog open={dialog === "oauth"} onOpenChange={(o) => !o && closeOauthDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Connect {oauthProvider === "google" ? "Gmail / Google Workspace" : "Outlook / Microsoft 365"}
            </DialogTitle>
            <DialogDescription>
              {useAppPassword
                ? "Personal Gmail connects with an app password. Google doesn't allow sign-in here for @gmail.com addresses."
                : `Sign in with ${oauthProvider === "google" ? "Google" : "Microsoft"} in the window that opens. We never see your password, and warmup starts automatically.`}
            </DialogDescription>
          </DialogHeader>
          {oauthProvider === "google" && (
            <div className="space-y-1.5">
              <Label>Email address</Label>
              <Input
                placeholder="you@yourdomain.com"
                type="email"
                value={oauthEmail}
                disabled={Boolean(signIn)}
                onChange={(e) => setOauthEmail(e.target.value)}
              />
            </div>
          )}
          {useAppPassword ? (
            <div className="space-y-3 text-sm">
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Turn on 2-Step Verification for this Google account.</li>
                <li>
                  Open{" "}
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    Google app passwords
                  </a>
                  , create one (any name), and copy the 16-character code.
                </li>
                <li>Paste it below.</li>
              </ol>
              <div className="space-y-1.5">
                <Label>App password</Label>
                <Input
                  type="password"
                  placeholder="abcd efgh ijkl mnop"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                />
              </div>
            </div>
          ) : signIn ? (
            <div className="flex items-start gap-2 rounded-md border border-white/10 p-3 text-sm">
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
              <p className="text-muted-foreground">
                Finish signing in in the other window. This updates by itself.{" "}
                <a
                  href={signIn.authUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  Window didn&apos;t open?
                </a>
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeOauthDialog}>Cancel</Button>
            {useAppPassword ? (
              <Button onClick={connectGmailAppPassword} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />} Connect
              </Button>
            ) : (
              <Button onClick={beginSignIn} disabled={busy || Boolean(signIn)}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Sign in with {oauthProvider === "google" ? "Google" : "Microsoft"}
              </Button>
            )}
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
