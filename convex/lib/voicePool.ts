/**
 * Cloned-voice pool — action half. Every use of a cloned voice goes through
 * here: `resolveVoice` turns our stable key ("elv_…" / "blv_…") into the
 * engine's current voice id, loading it on demand (evicting the least
 * recently used, safe-to-drop voice when the pool is full). `withPooledVoice`
 * additionally reloads once if the engine reports the voice gone. See
 * convex/voicePool.ts for the pinning rules.
 *
 * Plain helpers, not registered functions: they run inside the caller's
 * action, so there's no action-calls-action hop.
 */
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { QUICK_HOLD_MS, type PoolProvider } from "../voicePool";

const PREFIX: Record<PoolProvider, string> = { elevenlabs: "elv_", bland: "blv_" };

/** Stable in-app key for a pooled clone (what pickers and settings store). */
export function newPooledVoiceKey(provider: PoolProvider): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `${PREFIX[provider]}${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Which engine a pooled key belongs to; null for library / legacy ids. */
export function pooledProvider(voice: string | undefined | null): PoolProvider | null {
  if (!voice) return null;
  if (voice.startsWith(PREFIX.elevenlabs)) return "elevenlabs";
  if (voice.startsWith(PREFIX.bland)) return "bland";
  return null;
}

type Engine = {
  create: (name: string, audio: Blob) => Promise<string>;
  remove: (remoteId: string) => Promise<void>;
  isMissing: (error: unknown) => boolean;
  isFull: (error: unknown) => boolean;
};

async function engine(provider: PoolProvider): Promise<Engine> {
  if (provider === "elevenlabs") {
    const el = await import("./elevenlabs");
    return {
      create: (name, audio) =>
        el.cloneVoice({
          name,
          audio,
          filename: "sample.wav",
          description: "Cloned in-app from a browser recording",
        }),
      remove: el.deleteVoice,
      isMissing: el.isVoiceMissingError,
      isFull: el.isVoiceLimitError,
    };
  }
  const bland = await import("./bland");
  return {
    create: (name, audio) =>
      bland.cloneVoice({
        name,
        audio,
        filename: "sample.wav",
        description: "Cloned in-app from a browser recording",
      }),
    remove: async (id) => {
      try {
        await bland.deleteVoice(id);
      } catch (error) {
        // Already gone upstream is as good as deleted. Bland answers a
        // delete of a voice it no longer has with a bare 400 "Error deleting
        // voice" (verified 2026-11-04), not a 404.
        const gone =
          bland.isBlandVoiceMissingError(error) ||
          (error instanceof Error && /^Bland 400: Error deleting voice/.test(error.message));
        if (!gone) throw error;
      }
    },
    isMissing: bland.isBlandVoiceMissingError,
    isFull: bland.isBlandCloneLimitError,
  };
}

async function removeQuietly(eng: Engine, remoteIds: string[]): Promise<void> {
  for (const id of remoteIds) {
    try {
      await eng.remove(id);
    } catch (error) {
      // A voice we failed to delete just occupies a slot until the "full"
      // retry frees another one; don't fail the user's request over it.
      console.error(`Voice pool: couldn't unload ${id}`, error);
    }
  }
}

type Clone = {
  id: Id<"clonedVoices">;
  name: string;
  provider: PoolProvider;
  sampleStorageId: Id<"_storage">;
};

/** Upload the stored recording as a new upstream voice. */
async function load(
  ctx: ActionCtx,
  voiceKey: string,
  clone: Clone,
  holdMs: number,
): Promise<string> {
  const eng = await engine(clone.provider);
  await removeQuietly(
    eng,
    await ctx.runMutation(internal.voicePool.claimEvictions, {
      provider: clone.provider,
      keepId: clone.id,
    }),
  );
  const audio = await ctx.storage.get(clone.sampleStorageId);
  if (!audio) throw new Error("This voice's recording is missing — clone it again");
  let remote: string;
  try {
    remote = await eng.create(clone.name, audio);
  } catch (error) {
    if (!eng.isFull(error)) throw error;
    // The account is fuller than our count (voices made by hand, or a
    // failed unload): free one more and try once more.
    await removeQuietly(
      eng,
      await ctx.runMutation(internal.voicePool.claimEvictions, {
        provider: clone.provider,
        keepId: clone.id,
        extra: 1,
      }),
    );
    remote = await eng.create(clone.name, audio);
  }
  console.log(`Voice pool: loaded ${voiceKey} on ${clone.provider} as ${remote}`);
  const { use, discard } = await ctx.runMutation(internal.voicePool.setRemote, {
    id: clone.id,
    remoteVoiceId: remote,
    holdMs,
  });
  if (discard) await removeQuietly(eng, [discard]);
  if (!use) throw new Error("That voice was deleted");
  // A live line still pointing at an old id (voice lost upstream) needs the
  // new one — re-push its config. No-op when nothing live uses the voice.
  const live = await ctx.runQuery(internal.voicePool.liveReceptionistsForVoice, {
    voiceId: voiceKey,
  });
  for (const receptionistId of live) {
    await ctx.scheduler.runAfter(0, internal.voiceActions.resyncReceptionistInternal, {
      receptionistId,
    });
  }
  return use;
}

/**
 * `workspaceId` refuses keys that belong to another workspace. `holdMs`
 * keeps the voice from being unloaded while this use runs: the default
 * covers a preview / voice note; browser tests and calls pass their max
 * length (live receptionists and running campaigns are pinned regardless).
 */
export type PoolUseOptions = { workspaceId?: Id<"workspaces">; holdMs?: number };

/** Make sure a pooled clone is loaded and return its upstream id. */
export async function ensurePooledVoice(
  ctx: ActionCtx,
  voiceKey: string,
  opts?: PoolUseOptions,
): Promise<string> {
  const holdMs = opts?.holdMs ?? QUICK_HOLD_MS;
  const clone = await ctx.runQuery(internal.voicePool.getClone, { voiceId: voiceKey });
  if (!clone || (opts?.workspaceId && clone.workspaceId !== opts.workspaceId)) {
    throw new Error("That cloned voice isn't available any more — pick another voice");
  }
  if (clone.remoteVoiceId) {
    await ctx.runMutation(internal.voicePool.touch, { id: clone.id, holdMs });
    return clone.remoteVoiceId;
  }
  if (!clone.sampleStorageId) {
    throw new Error("That cloned voice isn't available any more — pick another voice");
  }
  return await load(
    ctx,
    voiceKey,
    { ...clone, sampleStorageId: clone.sampleStorageId },
    holdMs,
  );
}

/**
 * The id to hand an engine for `voice`: pooled keys are loaded/resolved,
 * anything else (library voices like "maya", legacy ids) passes through.
 */
export async function resolveVoice(
  ctx: ActionCtx,
  voice: string,
  opts?: PoolUseOptions,
): Promise<string> {
  return pooledProvider(voice) ? await ensurePooledVoice(ctx, voice, opts) : voice;
}

/**
 * Run `run` with the voice's current upstream id, reloading once if the
 * engine reports the pooled voice gone.
 */
export async function withPooledVoice<T>(
  ctx: ActionCtx,
  voice: string,
  run: (remoteVoiceId: string) => Promise<T>,
  opts?: PoolUseOptions,
): Promise<T> {
  const provider = pooledProvider(voice);
  if (!provider) return await run(voice);
  const remote = await ensurePooledVoice(ctx, voice, opts);
  try {
    return await run(remote);
  } catch (error) {
    const eng = await engine(provider);
    if (!eng.isMissing(error)) throw error;
    const clone = await ctx.runQuery(internal.voicePool.getClone, { voiceId: voice });
    if (!clone?.sampleStorageId) throw error;
    await ctx.runMutation(internal.voicePool.clearRemote, {
      id: clone.id,
      remoteVoiceId: remote,
    });
    return await run(await ensurePooledVoice(ctx, voice, opts));
  }
}

/** Unload a clone upstream (if loaded) and drop its recording. */
export async function releasePooledVoice(ctx: ActionCtx, voiceKey: string): Promise<void> {
  const clone = await ctx.runQuery(internal.voicePool.getClone, { voiceId: voiceKey });
  if (!clone) return;
  const eng = await engine(clone.provider);
  if (clone.remoteVoiceId) await eng.remove(clone.remoteVoiceId);
  if (clone.sampleStorageId) {
    try {
      await ctx.storage.delete(clone.sampleStorageId);
    } catch (error) {
      // Already gone — the row is what matters.
      console.warn(`Voice pool: sample for ${voiceKey} already deleted`, error);
    }
  }
}
