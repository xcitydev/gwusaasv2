"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { hasConvex } from "@/lib/runtime";
import Link from "next/link";
import { CornerUpRight, Globe, Loader2, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { errorText } from "@/lib/public-errors";
import { Textarea } from "@/components/ui/textarea";
import { LEGAL_LINKS } from "@/lib/legal";

/** Setup mode (no Convex provider): outreach settings need Convex. */
export function SettingsTab() {
  if (!hasConvex) {
    return (
      <Card className="border-white/10">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Outreach settings appear once Convex is connected.
        </CardContent>
      </Card>
    );
  }
  return <SettingsTabLive />;
}

function SettingsTabLive() {
  const settings = useQuery(api.outreach.outreachSettings);
  // Mount the form only once settings resolve so state initializes from them.
  if (settings === undefined) {
    return <div className="h-40 animate-pulse rounded-xl bg-card" />;
  }
  return (
    <SettingsTabInner
      initialForwardEmail={settings?.forwardRepliesTo ?? ""}
      initialPostalAddress={settings?.postalAddress ?? ""}
    />
  );
}

function SettingsTabInner({
  initialForwardEmail,
  initialPostalAddress,
}: {
  initialForwardEmail: string;
  initialPostalAddress: string;
}) {
  const domains = useQuery(api.outreach.listDomains) ?? [];
  const setForward = useMutation(api.outreach.setForwardRepliesTo);
  const addDomain = useMutation(api.outreach.addDomain);
  const redirectAll = useMutation(api.outreach.redirectAllDomains);

  const [forwardEmail, setForwardEmail] = useState(initialForwardEmail);
  const [savingForward, setSavingForward] = useState(false);
  const setPostal = useMutation(api.outreach.setPostalAddress);
  const [postalAddress, setPostalAddress] = useState(initialPostalAddress);
  const [savingPostal, setSavingPostal] = useState(false);

  const savePostal = async () => {
    setSavingPostal(true);
    try {
      await setPostal({ address: postalAddress });
      toast.success(postalAddress.trim() ? "Postal address saved." : "Postal address removed.");
    } catch (e) {
      toast.error(errorText(e, "Couldn't save."));
    } finally {
      setSavingPostal(false);
    }
  };
  const [addOpen, setAddOpen] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [redirectOpen, setRedirectOpen] = useState(false);
  const [redirectTarget, setRedirectTarget] = useState("");

  const saveForward = async () => {
    setSavingForward(true);
    try {
      await setForward({ email: forwardEmail });
      toast.success(
        forwardEmail
          ? `Positive replies will be forwarded to ${forwardEmail}.`
          : "Reply forwarding turned off.",
      );
    } catch (e) {
      toast.error(errorText(e, "Couldn't save."));
    } finally {
      setSavingForward(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* CAN-SPAM: required before any campaign can go live. */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4 text-primary" /> Sender postal address
            {!initialPostalAddress && <StatusBadge status="required" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Anti-spam law (CAN-SPAM) requires a valid physical address in every
            marketing email. It&apos;s added to each email&apos;s footer with an{" "}
            <Link href={LEGAL_LINKS.optOut} className="text-primary underline-offset-4 hover:underline">
              unsubscribe link
            </Link>
            ; campaigns can&apos;t launch until it&apos;s set. A PO box or registered
            mail service works.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Textarea
              rows={2}
              maxLength={300}
              placeholder="Your Business LLC, 123 Main St, Suite 4, Miami, FL 33101, USA"
              value={postalAddress}
              onChange={(e) => setPostalAddress(e.target.value)}
            />
            <Button onClick={savePostal} disabled={savingPostal}>
              {savingPostal && <Loader2 className="size-4 animate-spin" />} Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CornerUpRight className="size-4 text-primary" /> Forward positive replies
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Every reply categorized as <strong>Interested</strong> is forwarded
            to this address, so your sales inbox only sees winners.
          </p>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="sales@yourbrand.com"
              value={forwardEmail}
              onChange={(e) => setForwardEmail(e.target.value)}
            />
            <Button onClick={saveForward} disabled={savingForward}>
              {savingForward && <Loader2 className="size-4 animate-spin" />} Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="size-4 text-primary" /> Your domains
          </CardTitle>
          <div className="flex gap-2">
            {domains.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setRedirectOpen(true)}>
                Redirect all
              </Button>
            )}
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Domains you buy from us appear here — and you can redirect them all
              to your main site in one click.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {domains.map((domain) => (
                <div key={domain._id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{domain.domain}</p>
                    {domain.redirectTarget && (
                      <p className="text-xs text-muted-foreground">
                        → redirects to {domain.redirectTarget}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={domain.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a domain</DialogTitle>
            <DialogDescription>
              Track a domain you own. Purchasing new domains through the platform
              goes live with the Porkbun integration.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5">Domain</Label>
            <Input
              placeholder="yourbrand-outreach.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                try {
                  await addDomain({ domain: newDomain });
                  toast.success(`${newDomain} added.`);
                  setAddOpen(false);
                  setNewDomain("");
                } catch (e) {
                  toast.error(errorText(e, "Couldn't add domain."));
                }
              }}
            >
              Add domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={redirectOpen} onOpenChange={setRedirectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redirect all domains</DialogTitle>
            <DialogDescription>
              Every domain in your list will forward visitors to one target —
              specify where they should land.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5">Redirect to</Label>
            <Input
              placeholder="yourbrand.com"
              value={redirectTarget}
              onChange={(e) => setRedirectTarget(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedirectOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                try {
                  const count = await redirectAll({ target: redirectTarget });
                  toast.success(
                    `${count} domain${count === 1 ? "" : "s"} now redirect to ${redirectTarget}.`,
                  );
                  setRedirectOpen(false);
                } catch (e) {
                  toast.error(errorText(e, "Couldn't set redirect."));
                }
              }}
            >
              Redirect all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
