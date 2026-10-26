"use client";

import { Component, type ReactNode, useSyncExternalStore } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Database } from "lucide-react";
import { hasConvex } from "@/lib/runtime";

const subscribeNever = () => () => {};

function SetupPlaceholder() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <Database className="size-8 text-muted-foreground" />
        <p className="font-medium">Convex isn&apos;t connected yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Run <code className="text-primary">npx convex dev</code> in the project
          folder, then restart the dev server. This page needs live data.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Setup-mode-only safety net. A subtree that calls a Convex hook without a
 * provider throws during render ("Could not find Convex client!"); this turns
 * that crash back into the setup placeholder. Never mounted when Convex is
 * configured, so connected rendering is untouched. (Error boundaries only act
 * on the client — the mounted gate below keeps throws out of prerendering.)
 */
class SetupErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <SetupPlaceholder /> : this.props.children;
  }
}

/**
 * Wraps pages that need live Convex data. Without NEXT_PUBLIC_CONVEX_URL the
 * Convex provider isn't mounted, so hooks would crash. The mounted gate keeps
 * prerendering/SSR (and the first client render, so hydration matches) on the
 * placeholder; after mount, setup-guarded pages render their static UI and
 * anything that still throws is caught by the boundary above. When Convex is
 * configured, children render exactly as before.
 */
export function LivePage({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  if (hasConvex) return <>{children}</>;
  if (!mounted) return <SetupPlaceholder />;
  return (
    <SetupErrorBoundary>
      {children}
    </SetupErrorBoundary>
  );
}
