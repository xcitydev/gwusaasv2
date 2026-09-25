"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Ban, Copy, KeyRound, Link2, Loader2, Plus } from "lucide-react";
import { formatInviteCode } from "@/lib/invite-codes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Could not copy — select it manually.");
  }
}

/** Mint, share and revoke the codes that unlock the GWU Onboarding Forms. */
export function InviteCodesCard() {
  const codes = useQuery(api.inviteCodes.adminList) ?? [];
  const create = useMutation(api.inviteCodes.adminCreate);
  const revoke = useMutation(api.inviteCodes.adminRevoke);
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const uses = maxUses.trim() === "" ? undefined : Number(maxUses);
    const days = expiresInDays.trim() === "" ? undefined : Number(expiresInDays);
    if (uses !== undefined && (!Number.isInteger(uses) || uses < 1)) {
      toast.error("Uses must be a whole number of at least 1 (leave empty for unlimited).");
      return;
    }
    if (days !== undefined && !(days > 0)) {
      toast.error("Expiry must be a positive number of days (leave empty for none).");
      return;
    }
    setBusy(true);
    try {
      const code = await create({
        label: label.trim() || undefined,
        maxUses: uses,
        expiresInDays: days,
        code: customCode.trim() || undefined,
      });
      toast.success(`Invite code ${formatInviteCode(code)} created.`);
      setLabel("");
      setCustomCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the code.");
    } finally {
      setBusy(false);
    }
  };

  const inviteLink = (code: string) =>
    `${window.location.origin}/sign-up?invite=${formatInviteCode(code)}`;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-primary" /> Invite codes
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Redeeming a code unlocks the GWU Onboarding Forms for that account.
          Share the code itself or the sign-up link. Leave uses empty for a
          reusable code.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid gap-2 sm:grid-cols-[1.4fr_0.7fr_0.8fr_1.2fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            placeholder="Label (e.g. Luna Realty)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Input
            placeholder="Uses"
            inputMode="numeric"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            aria-label="Maximum uses"
          />
          <Input
            placeholder="Expires (days)"
            inputMode="numeric"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            aria-label="Expires in days"
          />
          <Input
            placeholder="Custom code (optional)"
            value={customCode}
            onChange={(e) => setCustomCode(e.target.value)}
            className="font-mono uppercase"
          />
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Create
          </Button>
        </form>

        {codes.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created by</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.map((c) => {
                  const state = c.state;
                  return (
                    <TableRow key={c._id}>
                      <TableCell className="font-mono text-sm">
                        {formatInviteCode(c.code)}
                      </TableCell>
                      <TableCell>{c.label ?? "—"}</TableCell>
                      <TableCell>
                        {c.uses}
                        {c.maxUses !== undefined ? ` / ${c.maxUses}` : " / ∞"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.expiresAt !== undefined
                          ? new Date(c.expiresAt).toLocaleDateString()
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.createdBy}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            state === "active"
                              ? "border-primary/40 text-primary"
                              : "text-muted-foreground"
                          }
                        >
                          {state}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Copy code"
                            onClick={() => copy(formatInviteCode(c.code), "Code")}
                          >
                            <Copy className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Copy sign-up link"
                            onClick={() => copy(inviteLink(c.code), "Sign-up link")}
                          >
                            <Link2 className="size-4" />
                          </Button>
                          {c.status === "active" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Revoke code"
                              onClick={async () => {
                                try {
                                  await revoke({ id: c._id });
                                  toast.success("Code revoked.");
                                } catch (e) {
                                  toast.error(
                                    e instanceof Error ? e.message : "Could not revoke.",
                                  );
                                }
                              }}
                            >
                              <Ban className="size-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
