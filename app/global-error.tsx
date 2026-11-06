"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the
 * whole document, so it brings its own <html>/<body>, the dark theme class
 * and global styles, and avoids app components that need providers.
 */
export default function GlobalError({
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
    <html lang="en" className="dark h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center bg-background px-4 text-foreground">
        <title>Something went wrong</title>
        <div className="max-w-md rounded-xl border border-destructive/30 bg-card px-6 py-10 text-center">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The app hit an unexpected problem. Try again, or reload the page.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">ref {error.digest}</p>
          )}
          <button
            type="button"
            onClick={() => retry()}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
