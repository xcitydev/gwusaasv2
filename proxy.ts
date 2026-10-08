import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// "/" is the public homepage; signed-in visitors are redirected by the page.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Admin-shared forms invite links (/join/GWU-XXXX-XXXX).
  "/join(.*)",
  // Agenda Coach card: token-gated page the meeting bot shows as its camera.
  "/coach(.*)",
]);

const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default hasClerk
  ? clerkMiddleware(async (auth, req) => {
      const { pathname } = req.nextUrl;
      const { userId } = await auth();

      // JSON API routes answer JSON: a signed-out fetch() gets 401, never an
      // HTML redirect to the sign-in page it cannot parse.
      if (pathname.startsWith("/api/")) {
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        return NextResponse.next();
      }

      // The homepage is prerendered static; the signed-in bounce to the app
      // lives here so the page itself never has to read the session.
      if (pathname === "/" && userId) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }

      if (!isPublicRoute(req)) {
        await auth.protect();
      }
    })
  : // Setup mode: no Clerk keys yet, let everything through so the UI is previewable.
    () => NextResponse.next();

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|mp3|wav)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
