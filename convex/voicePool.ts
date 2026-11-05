/**
 * Cloned-voice pool — bookkeeping half (queries/mutations). The action half
 * is lib/voicePool.ts.
 *
 * Both voice engines run on ONE platform account each, and both cap how
 * many cloned voices the account may hold (ElevenLabs Creator 30, Bland
 * Start 1, …). So a clone's recording is kept in Convex storage and its
 * upstream voice exists only while needed. When an engine's pool is full,
 * the least-recently-used voice that is safe to drop is unloaded; it
 * reloads from the stored recording the next time it's used.
 *
 * Never unloaded ("pinned"):
 *  - voices on a LIVE receptionist (an inbound call can ring any second),
 *  - voices on a RUNNING qualifier campaign (calls are dialing / in flight),
 *  - voices still inside their `busyUntil` hold (set on every use: about a
 *    minute for a preview or voice note, the full length of a browser test
 *    or call),
 *  - pre-pool rows with no stored recording (nothing to reload from).
 */
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { getConfigValue } from "./config";

export const providerValidator = v.union(v.literal("bland"), v.literal("elevenlabs"));
export type PoolProvider = "bland" | "elevenlabs";

/** Default hold for a quick use (preview, voice note): the request's own length. */
export const QUICK_HOLD_MS = 60 * 1000;

const SLOT_KEYS = {
  bland: "blandVoiceSlots",
  elevenlabs: "elevenLabsVoiceSlots",
} as const;

/** The upstream id currently backing a row, if any. */
function remoteOf(row: Doc<"clonedVoices">): string | undefined {
  // Pre-pool rows (no stored sample) hold their upstream id in voiceId.
  return row.sampleStorageId ? row.remoteVoiceId : row.voiceId;
}

function providerOf(row: Doc<"clonedVoices">): PoolProvider {
  return row.provider ?? "bland";
}

/** Voice keys that must stay loaded because something live depends on them. */
async function pinnedKeys(ctx: QueryCtx): Promise<Set<string>> {
  const pinned = new Set<string>();
  for (const r of await ctx.db.query("receptionists").collect()) {
    if (r.status === "live" && r.phoneNumberId) pinned.add(r.voice);
  }
  for (const c of await ctx.db.query("qualifierCampaigns").collect()) {
    if (c.status === "running" && c.voice) pinned.add(c.voice);
  }
  return pinned;
}

export const getClone = internalQuery({
  args: { voiceId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("clonedVoices")
      .withIndex("by_voice", (q) => q.eq("voiceId", args.voiceId))
      .first();
    if (!row) return null;
    return {
      id: row._id,
      workspaceId: row.workspaceId,
      name: row.name,
      provider: providerOf(row),
      sampleStorageId: row.sampleStorageId ?? null,
      remoteVoiceId: remoteOf(row) ?? null,
    };
  },
});

/** Is this voice key on a live receptionist or a running campaign? */
export const isPinned = internalQuery({
  args: { voiceId: v.string() },
  handler: async (ctx, args) => (await pinnedKeys(ctx)).has(args.voiceId),
});

/** Mark a use: bumps LRU order and holds the voice loaded for `holdMs`. */
export const touch = internalMutation({
  args: { id: v.id("clonedVoices"), holdMs: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    const now = Date.now();
    await ctx.db.patch(args.id, {
      lastUsedAt: now,
      busyUntil: Math.max(row.busyUntil ?? 0, now + Math.max(0, args.holdMs)),
    });
  },
});

/**
 * Make room for one more loaded voice on `provider`. Picks the least
 * recently used voices that are safe to drop, clears them atomically (two
 * loads can never evict the same voice), and returns their upstream ids for
 * the caller to delete. `extra` frees slots beyond the configured cap — used
 * when the engine says the account is full even though our count disagrees.
 * Throws VOICE_POOL_BUSY when every loaded voice is pinned or in use.
 */
export const claimEvictions = internalMutation({
  args: {
    provider: providerValidator,
    keepId: v.id("clonedVoices"),
    extra: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<string[]> => {
    const cap = Math.max(1, Math.floor(await getConfigValue(ctx, SLOT_KEYS[args.provider])));
    const rows = (
      await ctx.db
        .query("clonedVoices")
        .withIndex("by_provider", (q) =>
          q.eq("provider", args.provider === "bland" ? "bland" : "elevenlabs"),
        )
        .collect()
    ).concat(
      // Legacy Bland rows have no provider field at all.
      args.provider === "bland"
        ? await ctx.db
            .query("clonedVoices")
            .withIndex("by_provider", (q) => q.eq("provider", undefined))
            .collect()
        : [],
    );
    const loaded = rows.filter((r) => remoteOf(r) !== undefined && r._id !== args.keepId);
    // +1 for the voice about to load.
    const excess = loaded.length + 1 - cap + (args.extra ?? 0);
    if (excess <= 0) return [];
    const pinned = await pinnedKeys(ctx);
    const now = Date.now();
    const evictable = loaded
      .filter(
        (r) => r.sampleStorageId && !pinned.has(r.voiceId) && (r.busyUntil ?? 0) <= now,
      )
      .sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0));
    if (evictable.length < excess) {
      throw new Error(
        args.extra
          ? "VOICE_POOL_FULL: The voice engine's clone limit is used up by voices the app doesn't manage. An admin needs to free a slot or raise the plan."
          : "VOICE_POOL_BUSY: Every cloned-voice slot is in use right now (live receptionists, running campaigns or calls in progress). Try again in a few minutes.",
      );
    }
    const freed: string[] = [];
    for (const row of evictable.slice(0, excess)) {
      freed.push(row.remoteVoiceId!);
      await ctx.db.patch(row._id, { remoteVoiceId: undefined });
    }
    return freed;
  },
});

/**
 * Record a freshly loaded voice. Returns the id to use, plus any id the
 * caller must delete upstream: a concurrent load that won the race, or the
 * row was deleted while we were loading.
 */
export const setRemote = internalMutation({
  args: { id: v.id("clonedVoices"), remoteVoiceId: v.string(), holdMs: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<{ use: string | null; discard: string | null }> => {
    const row = await ctx.db.get(args.id);
    if (!row) return { use: null, discard: args.remoteVoiceId };
    if (row.remoteVoiceId && row.remoteVoiceId !== args.remoteVoiceId) {
      return { use: row.remoteVoiceId, discard: args.remoteVoiceId };
    }
    const now = Date.now();
    await ctx.db.patch(args.id, {
      remoteVoiceId: args.remoteVoiceId,
      lastUsedAt: now,
      busyUntil: Math.max(row.busyUntil ?? 0, now + Math.max(0, args.holdMs)),
    });
    return { use: args.remoteVoiceId, discard: null };
  },
});

/** The engine no longer has this voice — forget it so the next use reloads. */
export const clearRemote = internalMutation({
  args: { id: v.id("clonedVoices"), remoteVoiceId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row?.sampleStorageId && row.remoteVoiceId === args.remoteVoiceId) {
      await ctx.db.patch(args.id, { remoteVoiceId: undefined });
    }
  },
});

/** Live receptionists speaking with this voice key (to re-sync after a reload). */
export const liveReceptionistsForVoice = internalQuery({
  args: { voiceId: v.string() },
  handler: async (ctx, args) => {
    const out = [];
    for (const r of await ctx.db.query("receptionists").collect()) {
      if (r.voice !== args.voiceId || r.status !== "live" || !r.phoneNumberId) continue;
      out.push(r._id);
    }
    return out;
  },
});
