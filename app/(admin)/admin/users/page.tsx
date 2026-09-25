"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Coins, KeyRound, Lock, LockOpen, MoreHorizontal, Search } from "lucide-react";
import { InviteCodesCard } from "@/components/admin/invite-codes";
import { Badge } from "@/components/ui/badge";
import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AdminUserRow = {
  _id: Id<"users">;
  _creationTime: number;
  email: string;
  name?: string;
  status: Doc<"users">["status"];
  adminRole?: Doc<"users">["adminRole"];
  formsAccess: boolean;
  formsAccessSource?: Doc<"users">["formsAccessSource"];
  plan: string;
  credits: number;
  workspaceId?: Id<"workspaces">;
};

function UsersTable() {
  const [search, setSearch] = useState("");
  const users = useQuery(api.admin.listUsers, { search }) ?? [];
  const setUserStatus = useMutation(api.admin.setUserStatus);
  const adjustCredits = useMutation(api.admin.adjustCredits);
  const setFormsAccess = useMutation(api.inviteCodes.adminSetFormsAccess);

  const toggleForms = async (u: AdminUserRow) => {
    try {
      await setFormsAccess({ userId: u._id, hasAccess: !u.formsAccess });
      toast.success(
        u.formsAccess ? "Forms access revoked." : "Forms access granted.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed.");
    }
  };

  const [lockTarget, setLockTarget] = useState<AdminUserRow | null>(null);
  const [creditTarget, setCreditTarget] = useState<AdminUserRow | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");

  const confirmLock = async () => {
    if (!lockTarget) return;
    const next = lockTarget.status === "locked" ? "active" : "locked";
    try {
      await setUserStatus({ userId: lockTarget._id, status: next });
      toast.success(next === "locked" ? "Account locked." : "Account unlocked.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed.");
    }
    setLockTarget(null);
  };

  const submitCredits = async () => {
    if (!creditTarget?.workspaceId) return;
    const amount = Number(creditAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error("Enter a non-zero amount (negative removes credits).");
      return;
    }
    try {
      await adjustCredits({
        workspaceId: creditTarget.workspaceId,
        amount,
        reason: creditReason,
      });
      toast.success("Credits updated.");
      setCreditTarget(null);
      setCreditAmount("");
      setCreditReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Adjustment failed.");
    }
  };

  return (
    <>
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email or name…"
          className="pl-9"
        />
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Forms</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No users yet.
                  </TableCell>
                </TableRow>
              )}
              {users.map((u) => (
                <TableRow key={u._id}>
                  <TableCell>
                    <p className="font-medium">{u.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell className="capitalize">
                    {u.plan}
                    {u.adminRole && (
                      <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                        {u.adminRole}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{u.credits.toLocaleString()}</TableCell>
                  <TableCell>
                    {u.formsAccess ? (
                      <Badge variant="outline" className="border-primary/40 text-primary">
                        {u.adminRole
                          ? "admin"
                          : u.formsAccessSource === "invite"
                            ? "invited"
                            : "granted"}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={u.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(u._creationTime).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="User actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setCreditTarget(u)}>
                          <Coins className="size-4" /> Adjust credits
                        </DropdownMenuItem>
                        {!u.adminRole && (
                          <DropdownMenuItem onClick={() => toggleForms(u)}>
                            <KeyRound className="size-4" />
                            {u.formsAccess ? "Revoke forms access" : "Grant forms access"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          variant={u.status === "locked" ? "default" : "destructive"}
                          onClick={() => setLockTarget(u)}
                        >
                          {u.status === "locked" ? (
                            <>
                              <LockOpen className="size-4" /> Unlock account
                            </>
                          ) : (
                            <>
                              <Lock className="size-4" /> Lock account
                            </>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={lockTarget !== null} onOpenChange={(o) => !o && setLockTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lockTarget?.status === "locked" ? "Unlock" : "Lock"} {lockTarget?.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lockTarget?.status === "locked"
                ? "They will regain full access to their account."
                : "They will be unable to use the platform until unlocked. Superadmin only."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLock}>
              {lockTarget?.status === "locked" ? "Unlock" : "Lock"} account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={creditTarget !== null} onOpenChange={(o) => !o && setCreditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust credits — {creditTarget?.email}</DialogTitle>
            <DialogDescription>
              Current balance: {creditTarget?.credits.toLocaleString()} credits.
              Positive grants, negative removes. Superadmin only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Amount (e.g. 500 or -500)"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              inputMode="numeric"
            />
            <Input
              placeholder="Reason (shows in the ledger)"
              value={creditReason}
              onChange={(e) => setCreditReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitCredits}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminUsersPage() {
  return (
    <LivePage>
      <PageHeader
        title="Users"
        description="Every account on the platform. Invite codes unlock the GWU Onboarding Forms."
      />
      <InviteCodesCard />
      <UsersTable />
    </LivePage>
  );
}
