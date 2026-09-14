"use client";

import { ReactNode, useMemo } from "react";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { hasClerk, hasConvex, isConfigured } from "@/lib/runtime";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

const clerkAppearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: "#f2c518",
    colorPrimaryForeground: "#151204",
    colorBackground: "#161613",
    colorInput: "#1d1d1a",
    borderRadius: "0.75rem",
  },
} as const;

function ConvexClerkProviders({ children }: { children: ReactNode }) {
  const convex = useMemo(() => new ConvexReactClient(convexUrl!), []);
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

/** Local development against `npx convex dev` before Clerk keys exist. */
function ConvexOnlyProvider({ children }: { children: ReactNode }) {
  const convex = useMemo(() => new ConvexReactClient(convexUrl!), []);
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const inner = (
    <TooltipProvider delayDuration={200}>
      {children}
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
          },
        }}
      />
      {!isConfigured && <SetupBanner />}
    </TooltipProvider>
  );

  if (isConfigured) return <ConvexClerkProviders>{inner}</ConvexClerkProviders>;
  if (hasConvex) return <ConvexOnlyProvider>{inner}</ConvexOnlyProvider>;
  return inner;
}

/** Shown until Clerk + Convex env keys are added to .env.local. */
function SetupBanner() {
  const missing = [
    !hasClerk && "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    !hasConvex && "NEXT_PUBLIC_CONVEX_URL",
  ].filter(Boolean);
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-primary/30 bg-[#1a1705] px-4 py-2 text-center text-xs text-primary">
      Setup mode — missing {missing.join(", ")} in .env.local. Auth is disabled
      until keys are added.
    </div>
  );
}
