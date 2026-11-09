/**
 * One model list for the Studio composer. Studio models (lib/studio-models)
 * run on the Studio engine; the older Image / Video / Motion catalog
 * (lib/ai-models) runs on the standard engine. Both are shown through the
 * StudioModel shape so the composer, chips and reference slots stay the same.
 *
 * Client-side only: the server validates each engine with its own catalog.
 */
import {
  IMAGE_MODELS,
  MOTION_MAX_SECONDS,
  MOTION_MODELS,
  VIDEO_MODELS,
  costInCredits,
  type MotionOrientation,
} from "@/lib/ai-models";
import { STUDIO_MODELS, type StudioModel } from "@/lib/studio-models";

export type PickerEngine = "studio" | "standard";

export type PickerModel = StudioModel & {
  engine: PickerEngine;
  /** Standard engine: which createActions kind + catalog id to call. */
  standard?: { kind: "image" | "video" | "motion"; id: string };
};

const opts = (values: (string | number)[], suffix = "") =>
  values.map((value) => ({ value: String(value), label: `${value}${suffix}` }));

const standardBase = {
  path: "",
  listUsd: 0,
  unit: "image" as const,
  timeoutMin: 10,
  engine: "standard" as const,
};

const STANDARD_MODELS: PickerModel[] = [
  ...IMAGE_MODELS.map(
    (m): PickerModel => ({
      ...standardBase,
      id: `std:${m.id}`,
      label: m.label,
      family: "image",
      tagline: m.supportsEdit
        ? "Edits your reference image from a prompt."
        : "Fast, reliable text-to-image.",
      output: "image",
      prompt: "required",
      image: m.supportsEdit ? { key: "reference", label: "Reference image", required: false } : undefined,
      fields: [
        {
          key: "resolution",
          label: "Resolution",
          type: "select",
          options: opts(m.resolutions),
          default: m.resolutions[0],
        },
      ],
      standard: { kind: "image", id: m.id },
    }),
  ),
  ...VIDEO_MODELS.map(
    (m): PickerModel => ({
      ...standardBase,
      id: `std:${m.id}`,
      label: m.label,
      family: "video",
      tagline: m.supportsReference
        ? "Text or image to video — add a start image to animate it."
        : "Text to video.",
      output: "video",
      unit: "second",
      prompt: "required",
      image: m.supportsReference ? { key: "reference", label: "Start image", required: false } : undefined,
      fields: [
        {
          key: "resolution",
          label: "Resolution",
          type: "select",
          options: opts(m.resolutions),
          default: m.resolutions[0],
        },
        {
          key: "duration",
          label: "Length",
          type: "select",
          options: opts(m.durations, " s"),
          default: String(m.durations[0]),
        },
      ],
      standard: { kind: "video", id: m.id },
    }),
  ),
  ...MOTION_MODELS.filter((m) => m.available).map(
    (m): PickerModel => ({
      ...standardBase,
      id: `std:${m.id}`,
      label: m.label,
      family: "motion",
      tagline: m.hint,
      output: "video",
      unit: "second",
      prompt: "optional",
      image: { key: "reference", label: "Character image", required: true },
      video: {
        key: "video",
        label: "Motion video",
        minSec: 1,
        maxSec: MOTION_MAX_SECONDS.video,
      },
      fields: [
        {
          key: "character_orientation",
          label: "Scene control — follow the",
          type: "select",
          options: [
            { value: "video", label: `Motion video (up to ${MOTION_MAX_SECONDS.video} s)` },
            { value: "image", label: `Character image (up to ${MOTION_MAX_SECONDS.image} s)` },
          ],
          default: "video",
        },
      ],
      standard: { kind: "motion", id: m.id },
    }),
  ),
];

export const PICKER_MODELS: PickerModel[] = [
  // AI Influencer has its own tab.
  ...STUDIO_MODELS.filter((m) => m.family !== "influencer").map(
    (m): PickerModel => ({ ...m, engine: "studio" }),
  ),
  ...STANDARD_MODELS,
];

export function findPickerModel(id: string): PickerModel | undefined {
  return PICKER_MODELS.find((m) => m.id === id);
}

export type StandardRequest = {
  kind: "image" | "video" | "motion";
  modelId: string;
  prompt: string;
  resolution: string;
  durationSec?: number;
  referenceUrl?: string;
  videoUrl?: string;
  characterOrientation?: MotionOrientation;
};

/** Composer state → the standard engine's request, or a user-facing reason it isn't ready. */
export function standardRequest(
  model: PickerModel,
  input: {
    prompt: string;
    options: Record<string, string | boolean>;
    startImage: string;
    videoUrl: string;
    videoSec: number | null;
  },
): StandardRequest | string {
  const std = model.standard!;
  const prompt = input.prompt.trim();
  if (std.kind !== "motion" && !prompt) return "Write a prompt first";
  if (std.kind === "motion") {
    if (!input.startImage) return "Add the character image first";
    if (!input.videoUrl) return "Add the motion video first";
    if (!input.videoSec) return "Waiting for the video's length…";
    const orientation = (input.options.character_orientation as MotionOrientation) ?? "video";
    if (input.videoSec > MOTION_MAX_SECONDS[orientation]) {
      return `Keep the motion video under ${MOTION_MAX_SECONDS[orientation]} seconds for this scene setting`;
    }
    return {
      kind: "motion",
      modelId: std.id,
      prompt,
      resolution: "auto",
      durationSec: input.videoSec,
      referenceUrl: input.startImage,
      videoUrl: input.videoUrl,
      characterOrientation: orientation,
    };
  }
  return {
    kind: std.kind,
    modelId: std.id,
    prompt,
    resolution: String(input.options.resolution ?? ""),
    durationSec: std.kind === "video" ? Number(input.options.duration) : undefined,
    referenceUrl: input.startImage || undefined,
  };
}

export function standardCredits(
  request: StandardRequest,
  pricing: { markup: number; creditPriceUsd: number },
): number {
  return costInCredits({
    kind: request.kind,
    modelId: request.modelId,
    durationSec: request.durationSec,
    resolution: request.resolution,
    markup: pricing.markup,
    creditPriceUsd: pricing.creditPriceUsd,
  });
}

/** Any model a composer can run — the picker list plus tab-only ones (AI Influencer). */
export function findAnyModel(id: string): PickerModel | undefined {
  const picked = findPickerModel(id);
  if (picked) return picked;
  const studio = STUDIO_MODELS.find((m) => m.id === id);
  return studio ? { ...studio, engine: "studio" } : undefined;
}
