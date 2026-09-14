import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Shown on auth pages while Clerk/Convex keys are missing from .env.local. */
export function SetupNotice({ page }: { page: string }) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Almost there</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          The {page} page renders Clerk&apos;s component once authentication is
          configured. Add these to <code className="text-primary">.env.local</code>:
        </p>
        <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
          <li>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</li>
          <li>CLERK_SECRET_KEY</li>
          <li>NEXT_PUBLIC_CONVEX_URL</li>
        </ul>
        <p>
          See <code className="text-primary">.env.local.example</code> for the
          full list, then restart the dev server.
        </p>
      </CardContent>
    </Card>
  );
}
