"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AtSign, Loader2, MessageCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListSkeleton } from "@/components/list-skeleton";
import { Inbox } from "./ig-inbox";

function serverMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : "";
  return raw.split("Uncaught Error: ").pop() || fallback;
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
    <Card className="mt-6 border-dashed">
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

function EnableHero() {
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
        <Button className="mt-1" onClick={doEnable} disabled={enabling}>
          {enabling && <Loader2 className="size-4 animate-spin" />} Enable
          Instagram DMs
        </Button>
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

export function IgDmsClient() {
  const account = useQuery(api.igDms.myAccount);

  return (
    <div>
      {account === undefined ? (
        <ListSkeleton rows={3} />
      ) : account === null || account.status === "none" ? (
        <EnableHero />
      ) : account.status === "pending_connect" ? (
        <ConnectStep />
      ) : (
        <Inbox account={account} />
      )}
      <AdminSetupCard />
    </div>
  );
}
