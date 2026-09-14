import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Database } from "lucide-react";
import { hasConvex } from "@/lib/runtime";

/**
 * Wraps pages that need live Convex data. Without NEXT_PUBLIC_CONVEX_URL the
 * Convex provider isn't mounted, so hooks would crash — show setup help instead.
 */
export function LivePage({ children }: { children: ReactNode }) {
  if (hasConvex) return <>{children}</>;
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
