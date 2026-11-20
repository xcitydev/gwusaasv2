import type { NextConfig } from "next";

/**
 * Baseline security headers on every response. No script-src CSP: Clerk,
 * Convex and the AI widgets load from too many origins to pin safely, so the
 * CSP only locks framing, plugins and <base>. /coach/[token] still works —
 * the meeting bot loads it as a top-level page, never in an iframe.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Mic/camera stay available to our own pages (voice cloning, browser calls).
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Proxied upstream bytes: nothing may execute (last matching rule wins).
      {
        source: "/api/proxy-image",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; sandbox; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
