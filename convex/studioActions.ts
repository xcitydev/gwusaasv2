import { internalAction, type ActionCtx } from "./_generated/server";
import { action } from "./lib/functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import {
  higgsfieldConfigured,
  submit,
  estimate,
  getStatus,
  cancel as cancelUpstream,
  terminalFailureMessage,
  HiggsfieldError,
} from "./lib/higgsfield";
import { probeMp4DurationSec } from "./lib/mp4";
import {
  findStudioModel,
  normalizeStudioInput,
  buildStudioBody,
  studioListUsd,
  tokenMeteredUsd,
  studioCreditsFromUsd,
  type StudioInput,
  type StudioModel,
} from "../lib/studio-models";

/**
 * Studio (Higgsfield) generation lifecycle. Unlike the fal path, nothing
 * waits inside an action: submit, then a self-rescheduling poll follows the
 * job (a 30-second Cinema Studio render can outlast the 10-minute action
 * cap). Credits are charged up front and refunded on any failure; results
 * are copied into our storage because Higgsfield keeps them only ~7 days.
 */

const NOT_CONFIGURED =
  "NOT_CONFIGURED: The Studio engine isn't connected yet (HIGGSFIELD_KEY_ID / HIGGSFIELD_KEY_SECRET).";

/** Their per-account concurrency cap: wait 30 s and try again, up to ~6 min. */
const MAX_SUBMIT_RETRIES = 12;
const SUBMIT_RETRY_MS = 30_000;

function webhookUrl(): string | undefined {
  const site = process.env.CONVEX_SITE_URL;
  return site ? `${site}/create/higgsfield-webhook` : undefined;
}

type Params = {
  provider?: string;
  body?: Record<string, unknown>;
  hfStatusUrl?: string;
  hfCancelUrl?: string;
  hfSubmittedAt?: number;
};

function paramsOf(generation: Doc<"generations">): Params {
  return (generation.params ?? {}) as Params;
}

/** Queue the job upstream; on a concurrency cap, come back later. */
async function submitJob(
  ctx: ActionCtx,
  generationId: Id<"generations">,
  model: StudioModel,
  body: Record<string, unknown>,
  attempt: number,
): Promise<void> {
  try {
    const sub = await submit(model.path, body, webhookUrl());
    await ctx.runMutation(internal.generations.markSubmitted, {
      id: generationId,
      providerRequestId: sub.requestId,
      statusUrl: sub.statusUrl,
      cancelUrl: sub.cancelUrl ?? undefined,
    });
    await ctx.scheduler.runAfter(8_000, internal.studioActions.poll, {
      generationId,
    });
  } catch (error) {
    if (
      error instanceof HiggsfieldError &&
      error.busy &&
      attempt < MAX_SUBMIT_RETRIES
    ) {
      await ctx.scheduler.runAfter(
        SUBMIT_RETRY_MS,
        internal.studioActions.retrySubmit,
        { generationId, attempt: attempt + 1 },
      );
      return;
    }
    const detail = error instanceof Error ? error.message : "Couldn't queue the job";
    await ctx.runMutation(internal.generations.finish, {
      id: generationId,
      status: "failed",
      error: detail.slice(0, 300),
    });
    throw new Error(`Generation failed — your credits were refunded. (${detail})`);
  }
}

const inputArgs = {
  modelId: v.string(),
  prompt: v.string(),
  // Model knobs (aspect_ratio, genre, camera_movement…) — whitelisted
  // against the catalog server-side, never passed through raw.
  options: v.optional(v.any()),
  // Single-image models: [start, end?]; multi-image models: the list.
  imageUrls: v.optional(v.array(v.string())),
  videoUrl: v.optional(v.string()),
  durationSec: v.optional(v.number()),
  batch: v.optional(v.number()),
};

type RawInput = {
  modelId: string;
  prompt: string;
  options?: unknown;
  imageUrls?: string[];
  videoUrl?: string;
  durationSec?: number;
  batch?: number;
};

/** Validate + (for source-video models) read the real billable length. */
async function prepare(
  args: RawInput,
): Promise<{ model: StudioModel; input: StudioInput; body: Record<string, unknown> }> {
  const model = findStudioModel(args.modelId);
  if (!model) throw new Error("Unknown model");
  const input = normalizeStudioInput(model, {
    prompt: args.prompt,
    options: (args.options ?? {}) as Record<string, unknown>,
    imageUrls: args.imageUrls ?? [],
    videoUrl: args.videoUrl,
    durationSec: args.durationSec,
    batch: args.batch,
  });
  // Source-video models bill per second of that video: read the real
  // length from the file, not the client's number.
  if (model.video && input.videoUrl) {
    const probed = await probeMp4DurationSec(input.videoUrl);
    const seconds = Math.ceil(probed ?? input.durationSec ?? 0);
    if (seconds <= 0) {
      throw new Error("Couldn't read the source video's length — try an MP4 or MOV");
    }
    if (seconds < model.video.minSec) {
      throw new Error(`The source video needs to be at least ${model.video.minSec} seconds`);
    }
    // Longer sources are trimmed upstream, so bill the trimmed length.
    input.durationSec = Math.min(seconds, model.video.maxSec);
  }
  return { model, input, body: buildStudioBody(model, input) };
}

/**
 * Live price from Higgsfield: a number for flat-priced models, their
 * token formula (evaluated here) for metered video; the catalog list
 * price only if the call itself fails.
 */
async function priceUsd(
  model: StudioModel,
  input: StudioInput,
  body: Record<string, unknown>,
): Promise<{ usd: number; exact: boolean }> {
  try {
    const result = await estimate(model.path, body);
    if (result.kind === "estimate") return { usd: result.usd, exact: true };
    const metered = tokenMeteredUsd(model, input);
    if (metered !== null) return { usd: metered, exact: true };
    console.error("Studio: unpriceable estimate description", model.id, result.text);
  } catch (error) {
    console.error("Studio: estimate failed, using list price", model.id, error);
  }
  return { usd: studioListUsd(model, input), exact: false };
}

/** What this exact form would cost — shown in the UI before generating. */
export const estimateCost = action({
  args: inputArgs,
  handler: async (
    ctx,
    args,
  ): Promise<{ credits: number; usd: number; exact: boolean }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const { model, input, body } = await prepare(args);
    const price = higgsfieldConfigured()
      ? await priceUsd(model, input, body)
      : { usd: studioListUsd(model, input), exact: false };
    const [markup, creditPriceUsd] = await Promise.all([
      ctx.runQuery(internal.config.getValue, { key: "generationMarkup" }),
      ctx.runQuery(internal.config.getValue, { key: "creditPriceUsd" }),
    ]);
    return {
      credits: studioCreditsFromUsd({
        baseUsd: price.usd,
        markup: Number(markup),
        creditPriceUsd: Number(creditPriceUsd),
      }),
      usd: price.usd,
      exact: price.exact,
    };
  },
});

/** The Studio tab's Generate button. */
export const generate = action({
  args: inputArgs,
  handler: async (ctx, args): Promise<Id<"generations">> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (!higgsfieldConfigured()) throw new Error(NOT_CONFIGURED);
    const { model, input, body } = await prepare(args);
    const price = await priceUsd(model, input, body);

    const { generationId } = await ctx.runMutation(internal.generations.start, {
      kind: model.output,
      model: model.id,
      prompt: input.prompt || model.label,
      params: {
        provider: "higgsfield",
        options: input.options,
        imageUrls: input.imageUrls,
        videoUrl: input.videoUrl,
        durationSec: input.durationSec,
        batch: input.batch,
        body,
        priceExact: price.exact,
      },
      durationSec: input.durationSec,
      provider: "higgsfield",
      baseUsd: price.usd,
    });
    await submitJob(ctx, generationId, model, body, 0);
    return generationId;
  },
});

export const retrySubmit = internalAction({
  args: { generationId: v.id("generations"), attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const generation = await ctx.runQuery(internal.generations.getInternal, {
      id: args.generationId,
    });
    if (!generation || generation.status !== "pending") return;
    const model = findStudioModel(generation.model);
    const body = paramsOf(generation).body;
    if (!model || !body) return;
    try {
      await submitJob(ctx, args.generationId, model, body, args.attempt);
    } catch (error) {
      console.error("Studio: resubmit failed", args.generationId, error);
    }
  },
});

/** Copy one output into our storage (theirs expires); falls back to their link. */
async function storeOne(
  ctx: ActionCtx,
  outputUrl: string,
): Promise<{ resultUrl: string; storageId?: Id<"_storage"> }> {
  try {
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const storageId = await ctx.storage.store(await res.blob());
    return { resultUrl: (await ctx.storage.getUrl(storageId)) ?? outputUrl, storageId };
  } catch (error) {
    // Still a success — the upstream link works for a week; log and keep it.
    console.error("Studio: couldn't copy the result into storage", error);
    return { resultUrl: outputUrl };
  }
}

/** Store every output and close the record; batch extras become their own rows. */
async function storeAndFinish(
  ctx: ActionCtx,
  generationId: Id<"generations">,
  outputUrls: string[],
): Promise<void> {
  const [first, ...rest] = outputUrls;
  const stored = await storeOne(ctx, first);
  await ctx.runMutation(internal.generations.finish, {
    id: generationId,
    status: "done",
    resultUrl: stored.resultUrl,
    storageId: stored.storageId,
  });
  if (rest.length > 0) {
    const extras = [];
    for (const url of rest.slice(0, 16)) extras.push(await storeOne(ctx, url));
    await ctx.runMutation(internal.generations.addExtraResults, {
      parentId: generationId,
      results: extras,
    });
  }
}

/** Follows one job until it ends; reschedules itself while it runs. */
export const poll = internalAction({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args): Promise<void> => {
    const generation = await ctx.runQuery(internal.generations.getInternal, {
      id: args.generationId,
    });
    if (!generation || generation.status === "done" || generation.status === "failed") {
      return;
    }
    const params = paramsOf(generation);
    const model = findStudioModel(generation.model);
    if (!params.hfStatusUrl || !model) return;

    let result: Awaited<ReturnType<typeof getStatus>> | null = null;
    try {
      result = await getStatus(params.hfStatusUrl);
    } catch (error) {
      console.error("Studio: status check failed", args.generationId, error);
    }
    if (result?.status === "completed") {
      if (result.outputUrl) {
        await storeAndFinish(ctx, args.generationId, result.outputUrls);
      } else {
        await ctx.runMutation(internal.generations.finish, {
          id: args.generationId,
          status: "failed",
          error: "The model finished without returning a file",
        });
      }
      return;
    }
    if (result && (result.status === "failed" || result.status === "nsfw" || result.status === "canceled")) {
      await ctx.runMutation(internal.generations.finish, {
        id: args.generationId,
        status: "failed",
        error: terminalFailureMessage(result),
      });
      return;
    }
    const elapsed = Date.now() - (params.hfSubmittedAt ?? generation._creationTime);
    if (elapsed > model.timeoutMin * 60_000) {
      if (params.hfCancelUrl) {
        try {
          await cancelUpstream(params.hfCancelUrl);
        } catch {
          // Already rendering — nothing to cancel.
        }
      }
      await ctx.runMutation(internal.generations.finish, {
        id: args.generationId,
        status: "failed",
        error: `Timed out after ${model.timeoutMin} minutes`,
      });
      return;
    }
    // Quick checks early (most jobs finish in a minute or two), then relax.
    const delay = elapsed < 2 * 60_000 ? 8_000 : 20_000;
    await ctx.scheduler.runAfter(delay, internal.studioActions.poll, {
      generationId: args.generationId,
    });
  },
});

/** Webhook poke (unsigned — so it only triggers a status re-read). */
export const onWebhook = internalAction({
  args: { requestId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const generation = await ctx.runQuery(internal.generations.getByProviderRequest, {
      providerRequestId: args.requestId,
    });
    if (!generation || generation.status === "done" || generation.status === "failed") {
      return;
    }
    await ctx.runAction(internal.studioActions.poll, { generationId: generation._id });
  },
});

/** Cancel a job that is still queued (rendering ones can't be stopped). */
export const cancelGeneration = action({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args): Promise<void> => {
    const generation = await ctx.runQuery(internal.generations.getOwn, {
      id: args.generationId,
    });
    if (!generation) throw new Error("Not found");
    if (generation.status === "done" || generation.status === "failed") return;
    // Create with AI (fal) jobs run to completion inside the generate action
    // and fal bills them regardless — refunding here would hand out the
    // render for free. They can't be canceled; a failure still refunds.
    if (generation.provider !== "higgsfield") {
      throw new Error("This job is already rendering — it can't be canceled now.");
    }
    const params = paramsOf(generation);
    if (params.hfCancelUrl) {
      try {
        await cancelUpstream(params.hfCancelUrl);
      } catch {
        throw new Error("It's already rendering — it can't be canceled now.");
      }
    }
    await ctx.runMutation(internal.generations.finish, {
      id: args.generationId,
      status: "failed",
      error: "Canceled by you",
    });
  },
});

/**
 * Admin diagnostic (CLI only: `npx convex run studioActions:probeEstimates`):
 * asks /estimate what each Studio model costs for its default settings.
 * Free — estimates never start a job.
 */
export const probeEstimates = internalAction({
  args: { imageUrl: v.string(), only: v.optional(v.array(v.string())) },
  handler: async (_ctx, args) => {
    const { STUDIO_MODELS } = await import("../lib/studio-models");
    const out: Record<string, unknown> = {};
    for (const model of STUDIO_MODELS) {
      if (args.only && !args.only.includes(model.id)) continue;
      if (model.video) continue; // needs a real source video
      try {
        const input = normalizeStudioInput(model, {
          prompt: "a red apple on a wooden table",
          options: model.special === "influencer" ? { tier: "normal", selection: { gender: ["female"] } } : {},
          imageUrls: model.images ? Array(Math.max(1, model.images.min)).fill(args.imageUrl) : model.image ? [args.imageUrl] : [],
          durationSec: model.duration?.default,
          batch: 1,
        });
        const body = buildStudioBody(model, input);
        const result = await estimate(model.path, body);
        out[model.id] = { result, listUsd: model.listUsd, unit: model.unit, seconds: input.durationSec };
      } catch (error) {
        out[model.id] = { error: error instanceof Error ? error.message.slice(0, 300) : String(error) };
      }
    }
    return out;
  },
});

/** Admin diagnostic (CLI only): what the Marketing Studio preset list looks like. */
export const probePresets = internalAction({
  args: {},
  handler: async () => {
    const { listMarketingPresets } = await import("./lib/higgsfield");
    const all = [];
    let cursor: number | null = 0;
    for (let page = 0; page < 10 && cursor !== null; page++) {
      const res = await listMarketingPresets({ cursor, size: 100 });
      all.push(...res.items);
      cursor = res.cursor;
    }
    const groups: Record<string, number> = {};
    const types: Record<string, number> = {};
    const formats: Record<string, number> = {};
    for (const p of all) {
      groups[p.metadata?.group_name ?? "(none)"] = (groups[p.metadata?.group_name ?? "(none)"] ?? 0) + 1;
      types[p.type ?? "(none)"] = (types[p.type ?? "(none)"] ?? 0) + 1;
      for (const f of p.format_slugs ?? []) formats[f] = (formats[f] ?? 0) + 1;
    }
    return { total: all.length, groups, types, formats, sample: all.slice(0, 3) };
  },
});

/** Ad presets for the Ads & Products tab (style recipes for Marketing Studio Image). */
export const marketingPresets = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ id: string; name: string; group: string; aspectRatio?: string; coverUrl?: string }[]> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (!higgsfieldConfigured()) throw new Error(NOT_CONFIGURED);
    const { listMarketingPresets } = await import("./lib/higgsfield");
    const out = [];
    let cursor: number | null = 0;
    for (let page = 0; page < 5 && cursor !== null; page++) {
      const res = await listMarketingPresets({ cursor, size: 100 });
      for (const item of res.items) {
        const cover = item.cover_image as unknown;
        out.push({
          id: item.id,
          name: item.name,
          group: item.metadata?.group_name ?? "Other",
          aspectRatio: item.metadata?.aspect_ratio,
          coverUrl:
            typeof cover === "string"
              ? cover
              : cover && typeof cover === "object" && "url" in cover
                ? String((cover as { url: unknown }).url)
                : undefined,
        });
      }
      cursor = res.cursor;
    }
    return out;
  },
});
