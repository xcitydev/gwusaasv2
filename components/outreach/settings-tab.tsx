"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { CornerUpRight, Globe, Loader2, Plus } from "lucide-react";
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

export function SettingsTab() {
  const settings = useQuery(api.outreach.outreachSettings);
  // Mount the form only once settings resolve so state initializes from them.
  if (settings === undefined) {
    return <div className="h-40 animate-pulse rounded-xl bg-card" />;
  }
  return <SettingsTabInner initialForwardEmail={settings?.forwardRepliesTo ?? ""} />;
}

function SettingsTabInner({ initialForwardEmail }: { initialForwardEmail: string }) {
  const domains = useQuery(api.outreach.listDomains) ?? [];
  const setForward = useMutation(api.outreach.setForwardRepliesTo);
  const addDomain = useMutation(api.outreach.addDomain);
  const redirectAll = useMutation(api.outreach.redirectAllDomains);

  const [forwardEmail, setForwardEmail] = useState(initialForwardEmail);
  const [savingForward, setSavingForward] = useState(false);
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
      toast.error(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSavingForward(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
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
                  toast.error(e instanceof Error ? e.message : "Couldn't add domain.");
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
                  toast.error(e instanceof Error ? e.message : "Couldn't set redirect.");
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
