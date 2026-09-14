/**
 * Generation model catalog: what each model supports and what it costs us
 * (base provider price in USD). User price = base × generationMarkup (admin
 * config, default 3), converted to credits at creditPriceUsd.
 *
 * Prices are provider list prices at time of writing — revisit before launch.
 */

export type ImageModel = {
  id: string;
  label: string;
  provider: string; // fal.ai route
  baseUsd: number; // per image
  resolutions: string[];
  supportsEdit?: boolean;
};

export type VideoModel = {
  id: string;
  label: string;
  // fal routes runtime-verified 2026-09-07: text-to-video and image-to-video
  // are SEPARATE endpoints; null = that mode isn't offered by the model.
  providerT2V: string | null;
  providerI2V: string | null;
  perSecondUsd: number;
  durations: number[]; // seconds the model can generate
  resolutions: string[];
  supportsReference?: boolean;
};

export const IMAGE_MODELS: ImageModel[] = [
  {
    id: "flux-pro-1.1",
    label: "FLUX Pro 1.1",
    provider: "fal-ai/flux-pro/v1.1",
    baseUsd: 0.04,
    resolutions: ["1024×1024", "1024×1440", "1440×1024", "2048×2048"],
  },
  {
    id: "flux-dev",
    label: "FLUX Dev (fast)",
    provider: "fal-ai/flux/dev",
    baseUsd: 0.025,
    resolutions: ["1024×1024", "1024×1440", "1440×1024"],
  },
  {
    id: "recraft-v3",
    label: "Recraft V3",
    provider: "fal-ai/recraft-v3",
    baseUsd: 0.04,
    resolutions: ["1024×1024", "1365×1024", "1024×1365"],
  },
  {
    id: "ideogram-v3",
    label: "Ideogram V3 (text in images)",
    provider: "fal-ai/ideogram/v3",
    baseUsd: 0.08,
    resolutions: ["1024×1024", "1152×864", "864×1152"],
  },
  {
    id: "nano-banana-edit",
    label: "Nano Banana (edit)",
    provider: "fal-ai/nano-banana/edit",
    baseUsd: 0.039,
    resolutions: ["1024×1024"],
    supportsEdit: true,
  },
];

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "kling-2.5-turbo-pro",
    label: "Kling 2.5 Turbo Pro",
    providerT2V: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    providerI2V: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    perSecondUsd: 0.07,
    durations: [5, 10],
    resolutions: ["720p", "1080p"],
    supportsReference: true,
  },
  {
    id: "veo-3-fast",
    label: "Google Veo 3 Fast (with audio)",
    providerT2V: "fal-ai/veo3/fast",
    providerI2V: "fal-ai/veo3/fast/image-to-video",
    perSecondUsd: 0.4,
    durations: [8],
    resolutions: ["720p", "1080p"],
    supportsReference: true,
  },
  {
    id: "seedance-1-pro",
    label: "ByteDance Seedance 1.0 Pro",
    providerT2V: "fal-ai/bytedance/seedance/v1/pro/text-to-video",
    providerI2V: "fal-ai/bytedance/seedance/v1/pro/image-to-video",
    perSecondUsd: 0.1,
    durations: [5, 10],
    resolutions: ["720p", "1080p"],
    supportsReference: true,
  },
  {
    id: "luma-ray-2",
    label: "Luma Ray 2",
    providerT2V: "fal-ai/luma-dream-machine/ray-2",
    providerI2V: "fal-ai/luma-dream-machine/ray-2/image-to-video",
    perSecondUsd: 0.18,
    durations: [5, 9],
    resolutions: ["720p", "1080p"],
    supportsReference: true,
  },
  {
    id: "hailuo-02",
    label: "MiniMax Hailuo 02",
    providerT2V: "fal-ai/minimax/hailuo-02/standard/text-to-video",
    providerI2V: "fal-ai/minimax/hailuo-02/standard/image-to-video",
    perSecondUsd: 0.045,
    durations: [6, 10],
    resolutions: ["768p", "1080p"],
    supportsReference: true,
  },
];

export function findImageModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

export function findVideoModel(id: string): VideoModel | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}

/** base provider cost in USD for one generation */
export function baseCostUsd(args: {
  kind: "image" | "video";
  modelId: string;
  durationSec?: number;
}): number {
  if (args.kind === "image") {
    return findImageModel(args.modelId)?.baseUsd ?? 0;
  }
  const model = findVideoModel(args.modelId);
  if (!model) return 0;
  return model.perSecondUsd * (args.durationSec ?? model.durations[0]);
}

/** credits charged = base × markup ÷ creditPrice, rounded up */
export function costInCredits(args: {
  kind: "image" | "video";
  modelId: string;
  durationSec?: number;
  markup: number;
  creditPriceUsd: number;
}): number {
  const usd = baseCostUsd(args) * args.markup;
  if (args.creditPriceUsd <= 0) return 0;
  return Math.ceil(usd / args.creditPriceUsd);
}
