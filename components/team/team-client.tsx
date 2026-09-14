"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Copy, Crown, Loader2, Sparkles, Trash2, UserPlus, UsersRound, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
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

export function TeamClient() {
  const data = useQuery(api.team.members);
  const invite = useMutation(api.team.invite);
  const revokeInvite = useMutation(api.team.revokeInvite);
  const removeMember = useMutation(api.team.removeMember);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: Id<"members">; email: string } | null>(null);

  if (data && data.plan !== "team") {
    return (
      <Card className="border-primary/30 bg-gradient-to-b from-primary/5 to-transparent">
        <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <UsersRound className="size-7" />
          </span>
          <div>
            <p className="font-display text-xl italic">Teams are an Agency feature</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Upgrade to the Team/Agency plan to add members, share leads and
              campaigns, and get 3× the credits.
            </p>
          </div>
          <Button asChild>
            <Link href="/settings">
              <Sparkles className="size-4" /> Upgrade in Settings
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const sendInvite = async () => {
    setInviting(true);
    try {
      const token = await invite({ email });
      setInviteLink(`${window.location.origin}/invite/${token}`);
      setEmail("");
      toast.success("Invite created — share the link with your teammate.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invite failed.");
    } finally {
      setInviting(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data?.members.length ?? 0} member{(data?.members.length ?? 0) === 1 ? "" : "s"}
        </p>
        {data?.isOwner && (
          <Button onClick={() => { setInviteOpen(true); setInviteLink(null); }}>
            <UserPlus className="size-4" /> Invite member
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          {(data?.members ?? []).map((member) => (
            <div key={member.membershipId} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {member.name ?? member.email}
                  {member.isYou && (
                    <span className="text-xs text-muted-foreground">(you)</span>
                  )}
                  {member.role === "owner" && <Crown className="size-3.5 text-primary" />}
                </p>
                <p className="text-xs text-muted-foreground">{member.email}</p>
              </div>
              {data?.isOwner && member.role !== "owner" && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${member.email}`}
                  onClick={() => setRemoveTarget({ id: member.membershipId, email: member.email })}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {(data?.pendingInvites.length ?? 0) > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Pending invites</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {data!.pendingInvites.map((pendingInvite) => (
              <div key={pendingInvite._id} className="flex items-center justify-between gap-3 px-5 py-3">
                <p className="text-sm">{pendingInvite.email}</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-primary/40 text-primary">
                    Pending
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Revoke invite"
                    onClick={async () => {
                      await revokeInvite({ id: pendingInvite._id });
                      toast.success("Invite revoked.");
                    }}
                  >
                    <X className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>
              They&apos;ll share your workspace — leads, campaigns and credits.
            </DialogDescription>
          </DialogHeader>
          {inviteLink ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Send them this link — it lets them join after signing up:
              </p>
              <div className="flex gap-2">
                <Input readOnly value={inviteLink} className="font-mono text-xs" />
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(inviteLink);
                    toast.success("Invite link copied.");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Input
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              {inviteLink ? "Done" : "Cancel"}
            </Button>
            {!inviteLink && (
              <Button onClick={sendInvite} disabled={inviting || !email.trim()}>
                {inviting && <Loader2 className="size-4 animate-spin" />} Create invite
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeTarget !== null} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.email} from the team?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to this workspace immediately. Their personal
              account is untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!removeTarget) return;
                try {
                  await removeMember({ membershipId: removeTarget.id });
                  toast.success("Member removed.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Removal failed.");
                }
                setRemoveTarget(null);
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
