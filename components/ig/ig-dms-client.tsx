"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { hasConvex } from "@/lib/runtime";
import { AtSign, Loader2, MessageCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListSkeleton } from "@/components/list-skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Inbox } from "./ig-inbox";
import { errorText } from "@/lib/public-errors";

function serverMessage(e: unknown, fallback: string): string {
  return errorText(e, fallback);
}

/** Admin-only card: one-time agency installs (two private GHL apps). */
function AdminSetupCard() {
  const me = useQuery(api.users.me);
  const agencyInstallUrl = useAction(api.igDmsActions.agencyInstallUrl);
  const [loading, setLoading] = useState<string | null>(null);
  if (!me?.adminRole) return null;

  const openInstall = async (app: "provisioner" | "messenger") => {
    setLoading(app);
    try {
      const status = await agencyInstallUrl({});
      const entry = status[app];
      if (!entry.configured) {
        toast.error(`The ${app} app's client keys aren't in Convex yet.`);
        return;
      }
      if (entry.installed) {
        toast.info(`${app} already connected — re-installing refreshes the grant.`);
      }
      if (entry.url) window.open(entry.url, "_blank", "noopener");
    } catch (e) {
      toast.error(serverMessage(e, "Couldn't build the install link."));
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card className="mt-6 border-white/10">
      <CardContent className="flex flex-col items-start justify-between gap-3 py-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Admin:</span> connect
            both GHL apps once — provisioner (creates client workspaces), then
            messenger (handles the DMs).
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openInstall("provisioner")}
            disabled={loading !== null}
          >
            {loading === "provisioner" && <Loader2 className="size-4 animate-spin" />}
            1 · Provisioner
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openInstall("messenger")}
            disabled={loading !== null}
          >
            {loading === "messenger" && <Loader2 className="size-4 animate-spin" />}
            2 · Messenger
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Opens our messenger app's sub-account picker in the customer's own GHL.
 * The callback binds the pick; myAccount is reactive, so the page flips to
 * the inbox on its own once it lands.
 */
function useOwnGhlConnect() {
  const start = useAction(api.igDmsActions.startOwnGhlConnect);
  const [opening, setOpening] = useState(false);
  const connect = async () => {
    setOpening(true);
    try {
      const { url } = await start({});
      const popup = window.open(url, "own-ghl-connect", "width=760,height=820");
      if (!popup) {
        toast.error("Popup blocked — allow popups for this site and retry.");
        return;
      }
      toast.info("Pick the sub-account your Instagram is connected to.");
    } catch (e) {
      toast.error(serverMessage(e, "Couldn't start the connection."));
    } finally {
      setOpening(false);
    }
  };
  return { connect, opening };
}

function OwnGhlOption() {
  const config = useQuery(api.config.getAll);
  const { connect, opening } = useOwnGhlConnect();
  const [asking, setAsking] = useState(false);
  const affiliateUrl = config?.ghlAffiliateUrl?.trim();

  const haveOne = () => {
    setAsking(false);
    void connect();
  };
  const needOne = () => {
    setAsking(false);
    // Our referral link, so the signup earns the platform the commission.
    if (affiliateUrl) window.open(affiliateUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="mt-6 w-full max-w-md border-t border-white/10 pt-5">
      <p className="text-sm font-medium">Prefer your own GoHighLevel?</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Run your DMs through your own account instead of the quick setup.
      </p>
      <Button
        variant="outline"
        className="mt-3"
        onClick={() => setAsking(true)}
        disabled={opening}
      >
        {opening && <Loader2 className="size-4 animate-spin" />} Use my own GHL
      </Button>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Do you have a GoHighLevel account?</DialogTitle>
            <DialogDescription>
              {affiliateUrl
                ? "If you do, we'll connect it now. If not, you can create one first, then come back here and connect it."
                : "If you do, we'll connect it now. If not, use the quick setup above, which needs no extra account."}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Before connecting: your Instagram must already be connected inside
            that sub-account (Settings → Integrations).
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            {affiliateUrl ? (
              <Button variant="outline" onClick={needOne}>
                No, create one
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setAsking(false)}>
                No
              </Button>
            )}
            <Button onClick={haveOne}>Yes, connect it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Admin-only while the Meta app is unapproved (only its Instagram testers
 * can finish the login): connect straight to Meta's Instagram API.
 */
function useMetaConnect() {
  const start = useAction(api.igDmsActions.startMetaIgConnect);
  const [opening, setOpening] = useState(false);
  const connect = async () => {
    setOpening(true);
    try {
      const { url } = await start({});
      const popup = window.open(url, "meta-ig-connect", "width=600,height=760");
      if (!popup) toast.error("Popup blocked. Allow popups for this site and retry.");
    } catch (e) {
      toast.error(serverMessage(e, "Couldn't start the Instagram connection."));
    } finally {
      setOpening(false);
    }
  };
  return { connect, opening };
}

function MetaDirectOption({ compact = false }: { compact?: boolean }) {
  const me = useQuery(api.users.me);
  const { connect, opening } = useMetaConnect();
  if (!me?.adminRole) return null;
  if (compact) {
    // Above an existing GHL inbox: adds a second, direct connection.
    return (
      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-dashed border-white/15 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="text-muted-foreground">
          Admin beta: also connect an Instagram directly through our Meta app.
          It gets its own tab next to this one.
        </span>
        <Button variant="outline" size="sm" onClick={connect} disabled={opening}>
          {opening && <Loader2 className="size-4 animate-spin" />} Connect Instagram directly
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-6 w-full max-w-md rounded-lg border border-dashed border-white/15 p-4">
      <p className="text-sm font-medium">Admin beta: connect Instagram directly</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Uses our own Meta app (voice notes as real audio). Only Instagram
        accounts added as testers in the Meta dashboard can finish this until
        the app is approved.
      </p>
      <Button variant="outline" className="mt-3" onClick={connect} disabled={opening}>
        {opening && <Loader2 className="size-4 animate-spin" />} Connect Instagram directly
      </Button>
    </div>
  );
}

/** Thin bar over the inbox for workspaces connected straight to Meta. */
function MetaDirectBar({ username }: { username: string | null }) {
  const disconnect = useMutation(api.igDms.disconnectOwnGhl);
  const { connect, opening } = useMetaConnect();
  const [busy, setBusy] = useState(false);
  const doDisconnect = async () => {
    if (!window.confirm("Disconnect Instagram? Its DMs will be removed from this inbox (they stay on Instagram).")) {
      return;
    }
    setBusy(true);
    try {
      await disconnect({ channel: "meta" });
      toast.success("Disconnected.");
    } catch (e) {
      toast.error(serverMessage(e, "Couldn't disconnect."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-muted-foreground">
        Connected directly to Instagram
        {username && <span className="text-foreground"> as @{username}</span>}. New
        messages arrive instantly.
      </span>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" size="sm" onClick={connect} disabled={opening}>
          Reconnect
        </Button>
        <Button variant="ghost" size="sm" onClick={doDisconnect} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Disconnect
        </Button>
      </div>
    </div>
  );
}

/** Thin bar over the inbox for workspaces running on their own GHL. */
function OwnGhlBar() {
  const disconnect = useMutation(api.igDms.disconnectOwnGhl);
  const { connect, opening } = useOwnGhlConnect();
  const [busy, setBusy] = useState(false);
  const doDisconnect = async () => {
    if (
      !window.confirm(
        "Disconnect your GHL account? Your Instagram DMs will be removed from this inbox (they stay in GHL).",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await disconnect({});
      toast.success("Disconnected.");
    } catch (e) {
      toast.error(serverMessage(e, "Couldn't disconnect."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-muted-foreground">
        Running on <span className="text-foreground">your own GoHighLevel</span>{" "}
        account. No new messages? Check Instagram is connected there, then press Sync.
      </span>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" size="sm" onClick={connect} disabled={opening}>
          Reconnect
        </Button>
        <Button variant="ghost" size="sm" onClick={doDisconnect} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Disconnect
        </Button>
      </div>
    </div>
  );
}

function EnableHero({ isOwner }: { isOwner: boolean }) {
  const enable = useAction(api.igDmsActions.enableIgDms);
  const [enabling, setEnabling] = useState(false);

  const doEnable = async () => {
    setEnabling(true);
    try {
      await enable({});
      toast.success("DM workspace created — one step left: connect your Instagram.");
    } catch (e) {
      const msg = serverMessage(e, "Couldn't enable Instagram DMs.");
      toast.error(
        msg.includes("NOT_CONFIGURED")
          ? "Instagram DMs aren't switched on platform-wide yet — check back soon."
          : msg,
      );
    } finally {
      setEnabling(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 text-primary">
          <MessageCircle className="size-6" />
        </span>
        <p className="font-medium">Manage Instagram DMs from here</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Every DM to your Instagram lands in this inbox — reply yourself or
          let AI draft answers in your brand voice. Setup takes two minutes.
        </p>
        <Button className="mt-1" onClick={doEnable} disabled={enabling} data-tour="igdms-enable">
          {enabling && <Loader2 className="size-4 animate-spin" />} Enable
          Instagram DMs
        </Button>
        {isOwner && <OwnGhlOption />}
        {isOwner && <MetaDirectOption />}
      </CardContent>
    </Card>
  );
}

function ConnectStep() {
  const startIgConnect = useAction(api.igDmsActions.startIgConnect);
  const finishIgConnect = useAction(api.igDmsActions.finishIgConnect);
  const [connecting, setConnecting] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const connect = async () => {
    setConnecting(true);
    try {
      const { url } = await startIgConnect({});
      const popup = window.open(url, "ig-connect", "width=700,height=800");
      if (!popup) {
        toast.error("Popup blocked — allow popups for this site and retry.");
        return;
      }
      // GHL's OAuth window announces completion via postMessage with the
      // connected accountId; grab it and finish the attach server-side.
      const onMessage = async (event: MessageEvent) => {
        const data = event.data as Record<string, unknown> | null;
        const accountId =
          data && typeof data === "object"
            ? ((data.accountId ?? data.account_id) as string | undefined)
            : undefined;
        if (!accountId) return;
        window.removeEventListener("message", onMessage);
        setFinishing(true);
        try {
          const { igUsername } = await finishIgConnect({
            oauthAccountId: accountId,
          });
          toast.success(
            igUsername
              ? `@${igUsername} connected — DMs start flowing now.`
              : "Instagram connected — DMs start flowing now.",
          );
        } catch (e) {
          toast.error(serverMessage(e, "Couldn't finish the connection."));
        } finally {
          setFinishing(false);
        }
      };
      window.addEventListener("message", onMessage);
    } catch (e) {
      toast.error(serverMessage(e, "Couldn't start the Instagram connection."));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Card>
      <CardContent className="py-10">
        <div className="mx-auto max-w-lg space-y-4 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <AtSign className="size-5" />
          </span>
          <p className="font-medium">One step left: connect your Instagram</p>
          <p className="text-sm text-muted-foreground">
            Requirements: a{" "}
            <span className="text-foreground">Professional account</span>{" "}
            (Business or Creator) linked to a{" "}
            <span className="text-foreground">Facebook Page</span>. You&apos;ll
            authorize in a Meta popup — takes about a minute.
          </p>
          <Button onClick={connect} disabled={connecting || finishing}>
            {(connecting || finishing) && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {finishing ? "Finishing up…" : "Connect Instagram"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Setup mode (no Convex provider): connecting Instagram needs Convex. */
export function IgDmsClient() {
  if (!hasConvex) {
    return (
      <Card className="border-white/10">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <MessageCircle className="size-8 text-muted-foreground" />
          <p className="font-medium">Instagram DMs & AI Voice</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Connecting Instagram needs Convex — preview-only until it is connected.
          </p>
        </CardContent>
      </Card>
    );
  }
  return <IgDmsLive />;
}

/** GHL vs Instagram-direct switcher, shown when a workspace runs both. */
function ChannelSwitch({
  value,
  onChange,
  metaUsername,
}: {
  value: "ghl" | "meta";
  onChange: (value: "ghl" | "meta") => void;
  metaUsername: string | null;
}) {
  const options: { value: "ghl" | "meta"; label: string }[] = [
    { value: "ghl", label: "Via GHL" },
    { value: "meta", label: metaUsername ? `Direct · @${metaUsername}` : "Instagram direct" },
  ];
  return (
    <div className="mb-4 inline-flex rounded-lg border border-white/10 p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={
            value === o.value
              ? "rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-foreground"
              : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function IgDmsLive() {
  const account = useQuery(api.igDms.myAccount);
  const [channel, setChannel] = useState<"ghl" | "meta">("ghl");

  return (
    <div>
      {account === undefined ? (
        <ListSkeleton rows={3} />
      ) : account === null || account.status === "none" ? (
        <EnableHero isOwner={account?.isOwner ?? false} />
      ) : account.status === "pending_connect" ? (
        <ConnectStep />
      ) : (
        <>
          {account.hasGhl && account.meta ? (
            // Both connections: switch between them; each keeps its own list.
            <>
              <ChannelSwitch
                value={channel}
                onChange={setChannel}
                metaUsername={account.meta.igUsername}
              />
              {channel === "meta" && account.isOwner && (
                <MetaDirectBar username={account.meta.igUsername} />
              )}
              {channel === "ghl" && account.source === "own" && account.isOwner && <OwnGhlBar />}
              <Inbox key={channel} account={account} channel={channel} />
            </>
          ) : account.hasGhl ? (
            <>
              {account.source === "own" && account.isOwner && <OwnGhlBar />}
              {account.isOwner && <MetaDirectOption compact />}
              <Inbox account={account} />
            </>
          ) : (
            <>
              {account.isOwner && (
                <MetaDirectBar username={account.meta?.igUsername ?? account.igUsername} />
              )}
              <Inbox account={account} channel="meta" />
            </>
          )}
        </>
      )}
      <AdminSetupCard />
    </div>
  );
}
