"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2, ShieldMinus, UserPlus } from "lucide-react";
import { ListSkeleton } from "@/components/list-skeleton";
import { LivePage } from "@/components/live-page";
import { hasConvex } from "@/lib/runtime";
import { PageHeader } from "@/components/page-header";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLE_HELP: Record<string, string> = {
  regular: "Answer tickets and approve form submissions.",
  dev: "Everything regular can do, plus technical infrastructure views.",
  super: "Full control: revenue, admins, user accounts, platform config.",
};

function AdminsManager() {
  // undefined while loading — skeleton, not the "No admins" copy.
  const admins = useQuery(api.admin.listAdmins);
  const setAdminRole = useMutation(api.admin.setAdminRole);
  const [assignOpen, setAssignOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"regular" | "dev" | "super">("regular");
  const [removeTarget, setRemoveTarget] = useState<{ email: string } | null>(null);
  const [removing, setRemoving] = useState(false);

  const assign = async () => {
    try {
      await setAdminRole({ email, role });
      toast.success(`${email} is now a ${role} admin.`);
      setAssignOpen(false);
      setEmail("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assignment failed.");
    }
  };

  const remove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await setAdminRole({ email: removeTarget.email, role: null });
      toast.success("Admin access removed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Removal failed.");
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Admins"
        description="Assign regular, dev or super roles. Superadmin only."
        actions={
          <Button onClick={() => setAssignOpen(true)}>
            <UserPlus className="size-4" /> Assign role
          </Button>
        }
      />

      {admins === undefined ? (
        <ListSkeleton rows={3} />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {admins.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No admins yet — claim superadmin from the Overview page.
              </p>
            )}
            {admins.map((a) => (
              <div
                key={a._id}
                className="flex items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.name ?? a.email}</p>
                  <p className="text-xs text-muted-foreground">{a.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-primary">
                    {a.adminRole}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove admin"
                    onClick={() => setRemoveTarget({ email: a.email })}
                  >
                    <ShieldMinus className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign admin role</DialogTitle>
            <DialogDescription>
              The user must already have an account on the platform.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="user@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">Regular admin</SelectItem>
                <SelectItem value="dev">Dev admin</SelectItem>
                <SelectItem value="super">Superadmin</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button onClick={assign} disabled={!email.trim()}>
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(o) => !o && !removing && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove admin access for {removeTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They keep their account but lose the admin panel entirely.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={(e) => {
                // Keep the dialog open until the mutation settles.
                e.preventDefault();
                void remove();
              }}
            >
              {removing && <Loader2 className="size-4 animate-spin" />}
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AdminAdminsPage() {
  if (!hasConvex) {
    return (
      <Card className="border-white/10">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Admin roles are managed here once Convex is connected.
        </CardContent>
      </Card>
    );
  }
  return (
    <LivePage>
      <AdminsManager />
    </LivePage>
  );
}
