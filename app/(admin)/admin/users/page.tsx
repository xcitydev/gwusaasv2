"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  BadgeCheck,
  Coins,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { InviteCodesCard } from "@/components/admin/invite-codes";
import { errorText } from "@/lib/public-errors";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListSkeleton } from "@/components/list-skeleton";
import { LivePage } from "@/components/live-page";
import { hasConvex } from "@/lib/runtime";
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
  planSource?: "whop" | "admin";
  /** A live paid subscription pays for the plan; admin changes don't cancel it. */
  hasBilling: boolean;
  credits: number;
  workspaceId?: Id<"workspaces">;
  workspaceName?: string;
  ownsWorkspace: boolean;
};

type Plan = "free" | "personal" | "team";
const PLANS: Plan[] = ["free", "personal", "team"];
const PLAN_LABELS: Record<Plan, string> = { free: "Free", personal: "Personal", team: "Team" };

/** The plan an admin most likely wants next: one tier up, or Free from Team. */
function nextPlan(current: string): Plan {
  if (current === "free") return "personal";
  if (current === "personal") return "team";
  return "free";
}

function UsersTable() {
  const [search, setSearch] = useState("");
  // undefined while loading — render a skeleton, not the "No users" copy.
  const users = useQuery(api.admin.listUsers, { search });
  const config = useQuery(api.config.getAll);
  const setUserStatus = useMutation(api.admin.setUserStatus);
  const adjustCredits = useMutation(api.admin.adjustCredits);
  const setWorkspacePlan = useMutation(api.admin.setWorkspacePlan);
  const setFormsAccess = useMutation(api.inviteCodes.adminSetFormsAccess);
  const planCredits: Record<"personal" | "team", number | undefined> = {
    personal: config?.personalPlanCredits,
    team: config?.teamPlanCredits,
  };

  const [planTarget, setPlanTarget] = useState<AdminUserRow | null>(null);
  const [planChoice, setPlanChoice] = useState<Plan>("personal");
  const [planGrant, setPlanGrant] = useState(true);
  const [planReason, setPlanReason] = useState("");
  const [planBusy, setPlanBusy] = useState(false);

  const openPlan = (u: AdminUserRow) => {
    setPlanTarget(u);
    setPlanChoice(nextPlan(u.plan));
    setPlanGrant(true);
    setPlanReason("");
  };

  const submitPlan = async () => {
    if (!planTarget?.workspaceId) return;
    if (planChoice === planTarget.plan) {
      toast.error("Pick a different plan.");
      return;
    }
    setPlanBusy(true);
    try {
      const res = await setWorkspacePlan({
        workspaceId: planTarget.workspaceId,
        plan: planChoice,
        grantPlanCredits: planGrant,
        reason: planReason.trim() || undefined,
      });
      toast.success(
        `${planTarget.email} is now on the ${PLAN_LABELS[res.plan]} plan` +
          (res.credits > 0 ? ` (+${res.credits.toLocaleString()} credits).` : "."),
      );
      setPlanTarget(null);
    } catch (e) {
      toast.error(errorText(e, "Plan change failed."));
    } finally {
      setPlanBusy(false);
    }
  };

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
  const [locking, setLocking] = useState(false);
  const [creditTarget, setCreditTarget] = useState<AdminUserRow | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");

  const confirmLock = async () => {
    if (!lockTarget) return;
    const next = lockTarget.status === "locked" ? "active" : "locked";
    setLocking(true);
    try {
      await setUserStatus({ userId: lockTarget._id, status: next });
      toast.success(next === "locked" ? "Account locked." : "Account unlocked.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setLocking(false);
      setLockTarget(null);
    }
  };

  const submitCredits = async () => {
    if (!creditTarget) return;
    if (!creditTarget.workspaceId) {
      toast.error("This user has no workspace to adjust.");
      return;
    }
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
      {users === undefined ? (
        <ListSkeleton rows={6} />
      ) : (
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
                      {search.trim() ? "No users match that search." : "No users yet."}
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
                      {u.planSource === "admin" && (
                        <span
                          className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-400"
                          title="Plan set by an admin, not by a payment"
                        >
                          admin-set
                        </span>
                      )}
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
                          {/* No workspace → nothing to credit; hide rather than no-op. */}
                          {u.workspaceId && (
                            <>
                              <DropdownMenuItem onClick={() => openPlan(u)}>
                                <BadgeCheck className="size-4" /> Change plan
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setCreditTarget(u)}>
                                <Coins className="size-4" /> Adjust credits
                              </DropdownMenuItem>
                            </>
                          )}
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
      )}

      <AlertDialog
        open={lockTarget !== null}
        onOpenChange={(o) => !o && !locking && setLockTarget(null)}
      >
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
            <AlertDialogCancel disabled={locking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={locking}
              onClick={(e) => {
                // Keep the dialog open until the mutation settles.
                e.preventDefault();
                void confirmLock();
              }}
            >
              {locking && <Loader2 className="size-4 animate-spin" />}
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

      <Dialog
        open={planTarget !== null}
        onOpenChange={(o) => !o && !planBusy && setPlanTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change plan — {planTarget?.email}</DialogTitle>
            <DialogDescription>
              {planTarget?.workspaceName ?? "Their workspace"} is on the{" "}
              {PLAN_LABELS[(planTarget?.plan as Plan) ?? "free"]} plan
              {planTarget?.planSource === "admin" ? " (set by an admin)" : ""}. Plan
              gates unlock immediately. Superadmin only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="plan-choice">New plan</Label>
              <Select value={planChoice} onValueChange={(v) => setPlanChoice(v as Plan)}>
                <SelectTrigger id="plan-choice" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLANS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLAN_LABELS[p]}
                      {p === planTarget?.plan ? " (current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {planChoice !== "free" && (
              <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <Checkbox
                  checked={planGrant}
                  onCheckedChange={(c) => setPlanGrant(c === true)}
                  className="mt-0.5"
                />
                <span>
                  Grant the plan&apos;s monthly credits now
                  <span className="block text-xs text-muted-foreground">
                    {planCredits[planChoice] !== undefined
                      ? `${planCredits[planChoice]!.toLocaleString()} credits, `
                      : ""}
                    recorded in their ledger. Untick to change the plan only.
                  </span>
                </span>
              </label>
            )}
            {planTarget?.hasBilling && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                This workspace has an active paid subscription. Changing the plan here
                doesn&apos;t cancel billing — their next payment re-applies the paid plan.
                Cancel the subscription in Whop first if they shouldn&apos;t be charged.
              </p>
            )}
            {planTarget && !planTarget.ownsWorkspace && (
              <p className="text-xs text-muted-foreground">
                This user is a member of {planTarget.workspaceName ?? "a team workspace"};
                the plan applies to that whole workspace.
              </p>
            )}
            <Input
              placeholder="Reason (optional — kept on the workspace and in the ledger)"
              value={planReason}
              onChange={(e) => setPlanReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanTarget(null)} disabled={planBusy}>
              Cancel
            </Button>
            <Button
              onClick={submitPlan}
              disabled={planBusy || !planTarget || planChoice === planTarget.plan}
            >
              {planBusy && <Loader2 className="size-4 animate-spin" />}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminUsersPage() {
  if (!hasConvex) {
    return (
      <div>
        <PageHeader
          title="Users"
          description="Every account on the platform. Invite codes unlock the Creatily Onboarding Forms."
        />
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            This page fills in once Convex is connected — data and admin actions stay
            preview-only until then.
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <LivePage>
      <PageHeader
        title="Users"
        description="Every account on the platform. Invite codes unlock the Creatily Onboarding Forms."
      />
      <InviteCodesCard />
      <UsersTable />
    </LivePage>
  );
}
