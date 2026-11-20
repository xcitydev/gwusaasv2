import { internalAction, type ActionCtx } from "./_generated/server";
import { action } from "./lib/functions";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { probeMp4DurationSec } from "./lib/mp4";
import {
  DUB_LANGUAGES,
  MAX_DUB_SEC,
  MAX_VOICE_CHANGE_SEC,
  audioBaseUsd,
  findTtsModel,
} from "../lib/audio-models";

/**
 * The Audio tab: text-to-speech, voice changer and translate (dubbing), on
 * the ElevenLabs connection that also powers Studio HD voices. Credits are
 * charged up front through generations.start and refunded on any failure;
 * results are stored in our storage and show up in the gallery/Library.
 */

const NOT_CONFIGURED = "NOT_CONFIGURED: Audio isn't connected yet (ELEVENLABS_API_KEY).";
const DUB_POLL_MS = 15_000;
const DUB_TIMEOUT_MS = 60 * 60_000;

async function audioPricing(ctx: ActionCtx) {
  return await ctx.runQuery(api.audio.pricing, {});
}

async function eleven() {
  const lib = await import("./lib/elevenlabs");
  if (!lib.elevenConfigured()) throw new Error(NOT_CONFIGURED);
  return lib;
}

const isHttp = (u: string) => /^https?:\/\/\S+$/i.test(u.trim());

async function storeBytes(
  ctx: ActionCtx,
  id: Id<"generations">,
  data: Blob,
): Promise<void> {
  const storageId = await ctx.storage.store(data);
  const resultUrl = (await ctx.storage.getUrl(storageId)) ?? undefined;
  await ctx.runMutation(internal.generations.finish, {
    id,
    status: "done",
    resultUrl,
    storageId,
  });
}

async function fail(ctx: ActionCtx, id: Id<"generations">, error: unknown) {
  await ctx.runMutation(internal.generations.finish, {
    id,
    status: "failed",
    error: error instanceof Error ? error.message.slice(0, 300) : "Audio generation failed",
  });
}

/** Billable seconds: read from the file when it's an MP4, else the browser's measurement. */
async function billableSeconds(url: string, clientSec: number | undefined, max: number): Promise<number> {
  // MP4/MOV/M4A are read from the file itself; other formats fall back to the browser's number.
  const probed = await probeMp4DurationSec(url).catch(() => null);
  const seconds = Math.ceil(probed ?? clientSec ?? 0);
  if (seconds <= 0) throw new Error("Couldn't read the file's length — try an MP3, WAV or MP4");
  if (seconds > max) throw new Error(`Keep it under ${Math.round(max / 60)} minutes — trim the part you need`);
  return seconds;
}

/** Text to Speech: one voice reads the text. */
export const textToSpeech = action({
  args: {
    voiceId: v.string(),
    voiceName: v.optional(v.string()),
    text: v.string(),
    modelId: v.string(),
    stability: v.optional(v.number()),
    similarityBoost: v.optional(v.number()),
    style: v.optional(v.number()),
    speed: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"generations">> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const lib = await eleven();
    const model = findTtsModel(args.modelId);
    if (!model) throw new Error("Unknown model");
    const text = args.text.trim();
    if (!text) throw new Error("Write something to say first");
    if (text.length > model.maxChars) {
      throw new Error(`${model.label} reads up to ${model.maxChars.toLocaleString()} characters at a time`);
    }
    const clamp = (n: number | undefined, lo: number, hi: number) =>
      n === undefined || !Number.isFinite(n) ? undefined : Math.min(hi, Math.max(lo, n));
    const settings = {
      stability: clamp(args.stability, 0, 1),
      similarityBoost: clamp(args.similarityBoost, 0, 1),
      style: clamp(args.style, 0, 1),
      speed: clamp(args.speed, 0.7, 1.2),
    };

    const pricing = await audioPricing(ctx);
    const { generationId, workspaceId } = await ctx.runMutation(internal.generations.start, {
      kind: "audio",
      model: `tts:${model.id}`,
      prompt: text.slice(0, 500),
      params: { feature: "tts", voiceId: args.voiceId, voiceName: args.voiceName, modelId: model.id, settings, chars: text.length },
      provider: "elevenlabs",
      baseUsd: audioBaseUsd(pricing, { feature: "tts", chars: text.length }),
    });
    try {
      const { withPooledVoice } = await import("./lib/voicePool");
      const bytes = await withPooledVoice(
        ctx,
        args.voiceId,
        (remote) => lib.synthesize({ voiceId: remote, text, modelId: model.id, settings }),
        { workspaceId },
      );
      await storeBytes(ctx, generationId, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/mpeg" }));
    } catch (error) {
      await fail(ctx, generationId, error);
      throw error;
    }
    return generationId;
  },
});

/** Voice Change: same performance, different voice. */
export const voiceChange = action({
  args: {
    voiceId: v.string(),
    voiceName: v.optional(v.string()),
    mediaUrl: v.string(),
    fileName: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    removeBackgroundNoise: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"generations">> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const lib = await eleven();
    if (!isHttp(args.mediaUrl)) throw new Error("Add the audio or video first");
    const seconds = await billableSeconds(args.mediaUrl, args.durationSec, MAX_VOICE_CHANGE_SEC);

    const pricing = await audioPricing(ctx);
    const { generationId, workspaceId } = await ctx.runMutation(internal.generations.start, {
      kind: "audio",
      model: "voice-change",
      prompt: `Voice change → ${args.voiceName ?? "new voice"}`,
      params: { feature: "voice-change", voiceId: args.voiceId, voiceName: args.voiceName, sourceUrl: args.mediaUrl, seconds },
      durationSec: seconds,
      provider: "elevenlabs",
      baseUsd: audioBaseUsd(pricing, { feature: "voice-change", seconds }),
    });
    try {
      const res = await fetch(args.mediaUrl);
      if (!res.ok) throw new Error("Couldn't read the uploaded file");
      const media = await res.blob();
      const { withPooledVoice } = await import("./lib/voicePool");
      const bytes = await withPooledVoice(
        ctx,
        args.voiceId,
        (remote) =>
          lib.changeVoice({
            voiceId: remote,
            media,
            fileName: args.fileName || "source.mp3",
            removeBackgroundNoise: args.removeBackgroundNoise,
          }),
        { workspaceId },
      );
      await storeBytes(ctx, generationId, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/mpeg" }));
    } catch (error) {
      await fail(ctx, generationId, error);
      throw error;
    }
    return generationId;
  },
});

/** Translate: dub a video/audio into another language in the same voices. */
export const translate = action({
  args: {
    mediaUrl: v.string(),
    isVideo: v.boolean(),
    durationSec: v.optional(v.number()),
    targetLang: v.string(),
    sourceLang: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"generations">> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const lib = await eleven();
    if (!isHttp(args.mediaUrl)) throw new Error("Add the video or audio first");
    const target = DUB_LANGUAGES.find((l) => l.code === args.targetLang);
    if (!target) throw new Error("Pick a language to translate into");
    const source = args.sourceLang ? DUB_LANGUAGES.find((l) => l.code === args.sourceLang) : undefined;
    if (source && source.code === target.code) throw new Error("Pick a different language than the original");
    const seconds = await billableSeconds(args.mediaUrl, args.durationSec, MAX_DUB_SEC);

    const pricing = await audioPricing(ctx);
    const { generationId } = await ctx.runMutation(internal.generations.start, {
      kind: args.isVideo ? "video" : "audio",
      model: "translate",
      prompt: `Translated to ${target.label}`,
      params: { feature: "translate", sourceUrl: args.mediaUrl, targetLang: target.code, sourceLang: source?.code, seconds },
      durationSec: seconds,
      provider: "elevenlabs",
      baseUsd: audioBaseUsd(pricing, { feature: "translate", seconds }),
    });
    try {
      const { dubbingId } = await lib.startDubbing({
        sourceUrl: args.mediaUrl,
        targetLang: target.code,
        sourceLang: source?.code,
        name: `dub-${String(generationId).slice(-8)}`,
      });
      await ctx.runMutation(internal.audio.patchParams, {
        id: generationId,
        params: { dubbingId, startedAt: Date.now() },
        status: "running",
      });
      await ctx.scheduler.runAfter(DUB_POLL_MS, internal.audioActions.pollDub, { id: generationId });
    } catch (error) {
      await fail(ctx, generationId, error);
      throw error;
    }
    return generationId;
  },
});

/** Follows a dub until it's ready; reschedules itself while it runs. */
export const pollDub = internalAction({
  args: { id: v.id("generations") },
  handler: async (ctx, args): Promise<void> => {
    const generation = await ctx.runQuery(internal.generations.getInternal, { id: args.id });
    if (!generation || generation.status === "done" || generation.status === "failed") return;
    const params = (generation.params ?? {}) as { dubbingId?: string; targetLang?: string; startedAt?: number };
    if (!params.dubbingId || !params.targetLang) return;
    const lib = await import("./lib/elevenlabs");
    try {
      const status = await lib.getDubbing(params.dubbingId);
      if (status.status === "dubbed") {
        const file = await lib.getDubbedFile(params.dubbingId, params.targetLang);
        await storeBytes(ctx, args.id, file);
        return;
      }
      if (status.status === "failed") {
        await fail(ctx, args.id, new Error(`ElevenLabs dubbing failed: ${status.error ?? "unknown"}`));
        return;
      }
    } catch (error) {
      console.error("Audio: dub status check failed", args.id, error);
    }
    if (Date.now() - (params.startedAt ?? generation._creationTime) > DUB_TIMEOUT_MS) {
      await fail(ctx, args.id, new Error("Translation took too long — credits refunded"));
      return;
    }
    await ctx.scheduler.runAfter(DUB_POLL_MS, internal.audioActions.pollDub, { id: args.id });
  },
});
