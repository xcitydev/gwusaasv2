import {
  internalAction,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { phoneLeadKey } from "../lib/lead-keys";
import { addToBlocklist, instantlyConfigured } from "./lib/instantly";

/**
 * Privacy plumbing shared by outreach and the lead library:
 *  - emailSuppressions: addresses never emailed again (unsubscribe replies,
 *    public opt-outs). Global across workspaces.
 *  - dataOptOuts: public /opt-out requests; matching rows leave the shared
 *    lead library and are never re-added. Customers' own `leads` rows are
 *    NOT deleted (that's their data) — suppression stops them being emailed.
 */

type Ctx = QueryCtx | MutationCtx;

const normEmail = (email: string) => email.trim().toLowerCase();

/** True when this address must not be emailed through the platform. */
export async function isSuppressed(ctx: Ctx, email: string): Promise<boolean> {
  const row = await ctx.db
    .query("emailSuppressions")
    .withIndex("by_email", (q) => q.eq("email", normEmail(email)))
    .first();
  return row !== null;
}

/**
 * Suppress an address (idempotent) and mirror it to the sending engine's
 * block list so campaigns already live in Instantly stop mailing it too.
 */
export async function suppressEmail(
  ctx: MutationCtx,
  email: string,
  reason: Doc<"emailSuppressions">["reason"],
  workspaceId?: Id<"workspaces">,
): Promise<void> {
  const clean = normEmail(email);
  if (!clean.includes("@")) return;
  if (await isSuppressed(ctx, clean)) return;
  await ctx.db.insert("emailSuppressions", {
    email: clean,
    workspaceId,
    reason,
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.optOuts.blockInEngine, { email: clean });
}

/** Has this person opted out of the lead library (by email or phone)? */
export async function isOptedOut(
  ctx: Ctx,
  email: string | undefined,
  phoneKey: string | null | undefined,
): Promise<boolean> {
  const clean = email ? normEmail(email) : "";
  if (clean.includes("@")) {
    const byEmail = await ctx.db
      .query("dataOptOuts")
      .withIndex("by_email", (q) => q.eq("email", clean))
      .first();
    if (byEmail) return true;
  }
  if (phoneKey) {
    const byPhone = await ctx.db
      .query("dataOptOuts")
      .withIndex("by_phone_key", (q) => q.eq("phoneKey", phoneKey))
      .first();
    if (byPhone) return true;
  }
  return false;
}

export const blockInEngine = internalAction({
  args: { email: v.string() },
  handler: async (_ctx, args) => {
    if (!instantlyConfigured()) return;
    try {
      await addToBlocklist(args.email);
    } catch (error) {
      // Our own suppression list still blocks every future send.
      console.error("Engine block-list add failed:", error);
    }
  },
});

// ── Public opt-out form ─────────────────────────────────────────────────

const MAX_PER_IDENTIFIER_PER_DAY = 3;
const MAX_GLOBAL_PER_DAY = 2000;
/** Library rows removed per identifier per request (the pool dedupes, so this is generous). */
const MAX_ROWS = 200;
/** Lead-library sources whose dedupeKey can be a phone key (legacy rows lack phoneKey). */
const POOL_SOURCES = ["google_maps", "linkedin", "explorium", "realtor_agents"];

/** Bump a per-day counter; false once it is over `max`. */
async function underLimit(ctx: MutationCtx, key: string, max: number): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const row = await ctx.db
    .query("optOutRateLimits")
    .withIndex("by_key_day", (q) => q.eq("key", key).eq("day", day))
    .unique();
  if (row && row.count >= max) return false;
  if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
  else await ctx.db.insert("optOutRateLimits", { key, day, count: 1 });
  return true;
}

async function removeFromPool(
  ctx: MutationCtx,
  email: string | undefined,
  phoneKey: string | null,
): Promise<number> {
  const ids = new Set<Id<"leadPool">>();
  if (email) {
    for (const row of await ctx.db
      .query("leadPool")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(MAX_ROWS)) {
      ids.add(row._id);
    }
  }
  if (phoneKey) {
    for (const row of await ctx.db
      .query("leadPool")
      .withIndex("by_phone_key", (q) => q.eq("phoneKey", phoneKey))
      .take(MAX_ROWS)) {
      ids.add(row._id);
    }
    // Rows saved before phoneKey existed: phone-only leads are keyed by it.
    for (const source of POOL_SOURCES) {
      const row = await ctx.db
        .query("leadPool")
        .withIndex("by_source_key", (q) => q.eq("source", source).eq("dedupeKey", phoneKey))
        .unique();
      if (row) ids.add(row._id);
    }
  }
  // leadPoolQueries may still list these ids; lookup skips missing rows.
  for (const id of ids) await ctx.db.delete(id);
  return ids.size;
}

/**
 * Anyone (no sign-in) can ask to be removed from our lead data. Returns a
 * result instead of throwing so the message survives production error
 * redaction.
 */
export const submit = mutation({
  args: {
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    igHandle: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; error: string }> => {
    const email = args.email ? normEmail(args.email) : "";
    const phone = (args.phone ?? "").trim();
    const igHandle = (args.igHandle ?? "").trim().replace(/^@/, "").toLowerCase();

    if (email.length > 254 || phone.length > 32 || igHandle.length > 30) {
      return { ok: false, error: "One of the fields is too long." };
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: "Enter a valid email address." };
    }
    const phoneKey = phone ? phoneLeadKey(phone) : null;
    if (phone && !phoneKey) return { ok: false, error: "Enter a valid phone number." };
    if (igHandle && !/^[a-z0-9._]{1,30}$/.test(igHandle)) {
      return { ok: false, error: "Enter a valid Instagram handle." };
    }
    if (!email && !phoneKey && !igHandle) {
      return { ok: false, error: "Enter an email, phone number or Instagram handle." };
    }

    if (!(await underLimit(ctx, "global", MAX_GLOBAL_PER_DAY))) {
      return { ok: false, error: "We're receiving a lot of requests. Please try again tomorrow or email us." };
    }
    for (const key of [email && `e:${email}`, phoneKey && `p:${phoneKey}`, igHandle && `i:${igHandle}`]) {
      if (key && !(await underLimit(ctx, key, MAX_PER_IDENTIFIER_PER_DAY))) {
        return { ok: false, error: "This request was already received today." };
      }
    }

    const removedRows = await removeFromPool(ctx, email || undefined, phoneKey);
    if (email) await suppressEmail(ctx, email, "opt_out");
    await ctx.db.insert("dataOptOuts", {
      email: email || undefined,
      phoneKey: phoneKey ?? undefined,
      igHandle: igHandle || undefined,
      removedRows,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});
