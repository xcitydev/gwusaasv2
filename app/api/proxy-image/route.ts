import { NextRequest } from "next/server";

/**
 * Same-origin proxy for generated media so the carousel exporter can draw it
 * to a canvas without cross-origin tainting. Locked to OUR Convex deployment
 * and fal's media CDN, raster images only — anything it serves runs on our
 * origin, so it must never become an open proxy or an HTML/SVG host.
 */
const FAL_HOSTS = [/(^|\.)fal\.media$/, /(^|\.)fal\.ai$/];

/** Our own deployment's storage host (e.g. happy-otter-123.convex.cloud). */
const CONVEX_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_CONVEX_URL ?? "").hostname;
  } catch {
    return null;
  }
})();

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 25 * 1024 * 1024;

const SAFE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'",
  "Cache-Control": "private, max-age=86400",
};

function isAllowedHost(hostname: string): boolean {
  if (CONVEX_HOST && hostname === CONVEX_HOST) return true;
  return FAL_HOSTS.some((host) => host.test(hostname));
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return new Response("Missing url", { status: 400 });

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  if (url.protocol !== "https:" || url.port !== "" || !isAllowedHost(url.hostname)) {
    return new Response("Host not allowed", { status: 403 });
  }

  // No redirects: an allowed host must not bounce us somewhere else.
  const upstream = await fetch(url, { cache: "no-store", redirect: "manual" });
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream error", { status: 502 });
  }

  const type = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(type)) {
    await upstream.body.cancel();
    return new Response("Unsupported media type", { status: 415 });
  }
  const declared = Number(upstream.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    await upstream.body.cancel();
    return new Response("Too large", { status: 413 });
  }

  // Enforce the cap on the stream too — content-length can be absent or lie.
  let received = 0;
  const capped = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_BYTES) {
          controller.error(new Error("Image too large"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  return new Response(capped, {
    headers: { ...SAFE_HEADERS, "Content-Type": type },
  });
}
