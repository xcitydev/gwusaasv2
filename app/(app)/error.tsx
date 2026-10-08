"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Error boundary for every signed-in page. A query or render error inside a
 * page now degrades to this card (with the shell still around it) instead of
 * the bare React error screen. `retry()` re-fetches and re-renders the page.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex justify-center py-16">
      <Card className="max-w-md border-destructive/30">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="size-6" />
          </span>
          <div>
            <p className="font-medium">This page hit a problem</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Something went wrong while loading it. You can try again, or head
              back to the dashboard.
            </p>
            {error.digest && (
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                ref {error.digest}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => retry()}>Try again</Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
