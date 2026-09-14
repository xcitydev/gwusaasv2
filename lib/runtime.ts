/**
 * Environment capability flags. NEXT_PUBLIC_ vars are inlined at build time,
 * so these are stable constants — components use them to swap live
 * (hook-using) subtrees for static setup-mode fallbacks.
 *
 * - hasConvex: live data works (local `npx convex dev` counts).
 * - hasClerk: authentication works.
 * - isConfigured: full production mode (both).
 */
export const hasConvex = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
export const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
export const isConfigured = hasConvex && hasClerk;
