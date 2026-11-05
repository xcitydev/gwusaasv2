"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Lock } from "lucide-react";
import { hasConvex } from "@/lib/runtime";

/**
 * A locked account reads as signed-out to every backend helper, so pages
 * would just look empty. Say why instead.
 */
export function LockedNotice() {
  if (!hasConvex) return null;
  return <LockedNoticeLive />;
}

function LockedNoticeLive() {
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  if (me?.status !== "locked") return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <Lock className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p>
        This account has been locked, so your workspace is unavailable. Contact
        support if you think this is a mistake.
      </p>
    </div>
  );
}
