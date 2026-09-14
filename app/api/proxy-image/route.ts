import { NextRequest } from "next/server";

/**
 * Same-origin proxy for generated media so the carousel exporter can draw it
 * to a canvas without cross-origin tainting. Locked to our providers' CDNs —
 * this must never become an open proxy.
 */
const ALLOWED_HOSTS = [/(^|\.)fal\.media$/, /(^|\.)fal\.ai$/, /(^|\.)convex\.cloud$/];

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return new Response("Missing url", { status: 400 });

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  if (
    url.protocol !== "https:" ||
    !ALLOWED_HOSTS.some((host) => host.test(url.hostname))
  ) {
    return new Response("Host not allowed", { status: 403 });
  }

  const upstream = await fetch(url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream error", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
