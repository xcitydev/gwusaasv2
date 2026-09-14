"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { Crown, Loader2, ShieldAlert } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { isConfigured } from "@/lib/runtime";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown to non-admins. When the platform has no admin at all yet, the first
 * signed-in user can claim superadmin right here (a no-op the moment any
 * admin exists, enforced server-side).
 */
function Denied() {
  const hasAnyAdmin = useQuery(api.admin.hasAnyAdmin);
  const bootstrap = useMutation(api.admin.bootstrapSuper);
  const [claiming, setClaiming] = useState(false);

  if (hasAnyAdmin === false) {
    return (
      <div className="flex justify-center py-16">
        <Card className="max-w-md border-primary/30">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Crown className="size-6" />
            </span>
            <div>
              <p className="font-medium">No admin exists yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You&apos;re the first one here — claim the superadmin role to
                set up the platform. This only works once.
              </p>
            </div>
            <Button
              disabled={claiming}
              onClick={async () => {
                setClaiming(true);
                try {
                  await bootstrap();
                  toast.success("You are now the superadmin.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Claim failed.");
                } finally {
                  setClaiming(false);
                }
              }}
            >
              {claiming ? <Loader2 className="size-4 animate-spin" /> : <Crown className="size-4" />}
              Claim superadmin
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" />
      <div>
        <p className="font-medium">Admin access required</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask a superadmin to assign your account a role (Admin → Admins).
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}

function LiveGate({ children }: { children: ReactNode }) {
  const me = useQuery(api.users.me);
  if (me === undefined) {
    return (
      <div className="space-y-4 py-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!me?.adminRole) return <Denied />;
  return <>{children}</>;
}

/** Wraps every /admin page. In setup mode the gate is open for previewing. */
export function AdminGate({ children }: { children: ReactNode }) {
  if (!isConfigured) return <>{children}</>;
  return <LiveGate>{children}</LiveGate>;
}
