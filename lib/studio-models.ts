/**
 * Studio catalog — the Higgsfield models behind Create with AI's Studio
 * tab, and the pure helpers that turn a form into a request body. Shared
 * by the UI (form + cost preview) and Convex (validation, body, billing).
 *
 * Prices here are Higgsfield's LIST rates (not promo strikeouts) and only a
 * fallback: the server prices every job from their /estimate endpoint,
 * which the docs call authoritative for the account. Endpoints and fields
 * verified against docs.higgsfield.ai on 2026-09-22.
 */

export type StudioOption = { value: string; label: string };

export type StudioField =
  | {
      key: string;
      label: string;
      type: "select";
      options: StudioOption[];
      /** Omit from the request when unset — the model picks. */
      optional?: boolean;
      default?: string;
      helper?: string;
    }
  | { key: string; label: string; type: "toggle"; default: boolean; helper?: string };

export type StudioFamily = "image" | "video" | "genjutsu" | "motion";

export type StudioModel = {
  id: string;
  label: string;
  family: StudioFamily;
  tagline: string;
  /** POST path on api.higgsfield.ai. */
  path: string;
  output: "image" | "video";
  listUsd: number;
  unit: "image" | "second";
  prompt: "required" | "optional";
  /** Single start image (+ optional end frame) — image-to-video models. */
  image?: { key: string; label: string; required: boolean; helper?: string };
  endImage?: { key: string; label: string };
  /** Several reference images — Genjutsu characters, Cinema Studio refs. */
  images?: { key: string; label: string; min: number; max: number; helper?: string };
  /** A source video whose length is what gets billed. */
  video?: { key: string; label: string; minSec: number; maxSec: number; helper?: string };
  duration?: { min: number; max: number; default: number };
  batch?: { key: string; options: number[] };
  fields: StudioField[];
  /** Give up (and refund) after this long. */
  timeoutMin: number;
};

const opts = (values: string[], labels?: Record<string, string>): StudioOption[] =>
  values.map((value) => ({ value, label: labels?.[value] ?? value }));

const slugLabel = (value: string) =>
  value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const slugOpts = (values: string[]): StudioOption[] =>
  values.map((value) => ({ value, label: slugLabel(value) }));

const CAMERA_MOVEMENTS = [
  "static-shot", "slow-zoom-in", "slow-zoom-out", "dolly-in", "dolly-out",
  "dolly-zoom", "crush-zoom", "pan-left", "pan-right", "whip-pan", "tilt-up",
  "tilt-down", "truck-left", "truck-right", "slider-left", "slider-right",
  "arc-left", "arc-right", "tracking", "side-tracking", "handheld", "pov",
  "snorricam", "rack-focus", "pedestal-up", "pedestal-down", "crane-up",
  "crane-down", "drone-orbit", "aerial-pullback", "helicopter-shot",
  "bullet-time", "robot-arm",
];

const COLOR_PALETTES = [
  "static-noon", "twilight-fable", "back-row-kissing-seats",
  "on-the-other-side-of-the-porthole", "the-emerald-ambush", "highway-standoff",
  "the-faded-fresco", "oil-ochre", "the-mountain-convent", "ghost-in-the-code",
  "pink-velvet", "two-days-to-the-horizon", "industrial-fog", "stairs-go-up",
  "field-post", "home-is-the-next-gas-station", "glossy-flesh",
  "the-crimson-ballet", "neon-rain-at-midnight", "the-morning-after-rain",
  "the-iron-borough", "the-ground", "the-investigation", "turquoise-mirage",
  "a-dream-in-color", "breakfast-on-schedule", "favela-gold", "a-hotel-for-one",
  "after-dark", "crimson-vigi", "the-neighbors-saw-everything",
  "the-grey-channel", "mirage-at-noon", "bubblegum-boulevard", "yellow-room",
  "the-earth-keeps-things-reluctantly", "tropic-fever-dream",
  "bioluminescent-night", "dont-turn-it-off-im-watching",
  "the-silk-curtain-falls", "the-butterfly", "playtime", "wallpaper-romance",
  "overtime", "the-way-home-is-longer", "everyone-speaks-in-whispers",
  "runaway-summer", "amber-wasteland", "the-circus", "gasoline-sunset",
];

const audioToggle = (key: string): StudioField => ({
  key,
  label: "Generate audio",
  type: "toggle",
  default: true,
});

export const STUDIO_MODELS: StudioModel[] = [
  {
    id: "soul-2",
    label: "Soul 2",
    family: "image",
    tagline: "Higgsfield's signature photoreal image model — fashion, editorial, lifestyle.",
    path: "/higgsfield-ai/soul/v2/standard",
    output: "image",
    listUsd: 0.0032,
    unit: "image",
    prompt: "required",
    batch: { key: "batch_size", options: [1, 4] },
    fields: [
      {
        key: "aspect_ratio",
        label: "Aspect ratio",
        type: "select",
        options: opts(["1:1", "9:16", "16:9", "4:3", "3:4", "2:3", "3:2"]),
        default: "1:1",
      },
      {
        key: "resolution",
        label: "Resolution",
        type: "select",
        options: opts(["720p", "1080p"]),
        default: "720p",
      },
      {
        key: "enhance_prompt",
        label: "Enhance prompt",
        type: "toggle",
        default: false,
        helper: "Let the model expand short prompts.",
      },
    ],
    timeoutMin: 15,
  },
  {
    id: "cinema-studio-4",
    label: "Cinema Studio 4.0",
    family: "video",
    tagline: "Direct a shot: genre, era, camera move, lens, light and palette — with optional reference images.",
    path: "/higgsfield/cinema-studio/4.0",
    output: "video",
    // Token-metered: 720p 16:9 works out to $0.462/s (480p ≈ $0.206/s).
    listUsd: 0.462,
    unit: "second",
    prompt: "required",
    images: {
      key: "image_urls",
      label: "Reference images (optional)",
      min: 0,
      max: 4,
      helper: "Characters, locations or products the shot should feature.",
    },
    duration: { min: 4, max: 30, default: 5 },
    fields: [
      {
        key: "aspect_ratio",
        label: "Aspect ratio",
        type: "select",
        options: opts(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
        default: "16:9",
      },
      {
        key: "resolution",
        label: "Resolution",
        type: "select",
        options: opts(["720p", "480p"]),
        default: "720p",
      },
      {
        key: "genre",
        label: "Genre",
        type: "select",
        optional: true,
        options: slugOpts(["epic", "drama", "noir", "comedy", "horror", "action"]),
      },
      {
        key: "era",
        label: "Era",
        type: "select",
        optional: true,
        options: opts(["1960s", "1980s", "1990s", "2000s", "2020s"]),
      },
      {
        key: "camera_movement",
        label: "Camera move",
        type: "select",
        optional: true,
        options: slugOpts(CAMERA_MOVEMENTS),
      },
      {
        key: "camera_lens",
        label: "Lens",
        type: "select",
        optional: true,
        options: slugOpts([
          "clean-sharp", "anamorphic", "vintage-anamorphic", "warm-vintage", "halation-vintage",
        ]),
      },
      {
        key: "camera_model",
        label: "Camera",
        type: "select",
        optional: true,
        options: opts(["modern", "35mm-film", "8mm-film", "dv-camcorder"], {
          modern: "Modern digital",
          "35mm-film": "35mm film",
          "8mm-film": "8mm film",
          "dv-camcorder": "DV camcorder",
        }),
      },
      {
        key: "camera_aperture",
        label: "Aperture",
        type: "select",
        optional: true,
        options: opts(["f14-wide-open", "f4-moderate", "f11-deep-focus"], {
          "f14-wide-open": "f/1.4 — wide open",
          "f4-moderate": "f/4 — moderate",
          "f11-deep-focus": "f/11 — deep focus",
        }),
      },
      {
        key: "light",
        label: "Light",
        type: "select",
        optional: true,
        options: slugOpts([
          "silhouette", "practicals", "window", "overhead-fall", "contre-jour", "soft-cross",
        ]),
      },
      {
        key: "pacing",
        label: "Pacing",
        type: "select",
        optional: true,
        options: slugOpts(["calm", "dynamic", "chaotic", "single-shot"]),
      },
      {
        key: "color_palette",
        label: "Color palette",
        type: "select",
        optional: true,
        options: slugOpts(COLOR_PALETTES),
      },
      audioToggle("generate_audio"),
    ],
    timeoutMin: 40,
  },
  {
    id: "genjutsu-motion-transfer",
    label: "Genjutsu · Motion Transfer",
    family: "genjutsu",
    tagline: "Take a video's motion and recast it with your characters, products or clothes.",
    path: "/higgsfiled/genjutsu/motion-transfer/v1.0",
    output: "video",
    // List rate (their console shows $0.318/s before the 50% promo); the
    // live estimate overrides this when it answers.
    listUsd: 0.318,
    unit: "second",
    prompt: "optional",
    images: {
      key: "image_urls",
      label: "Characters, products or clothes (1–8 images)",
      min: 1,
      max: 8,
      helper: "The people or things that should perform the motion.",
    },
    video: {
      key: "video_url",
      label: "Source video (4–30 s)",
      minSec: 4,
      maxSec: 30,
      helper: "The motion to copy. Longer clips are trimmed to 30 s.",
    },
    fields: [
      {
        key: "resolution",
        label: "Resolution",
        type: "select",
        options: opts(["720p", "480p"]),
        default: "720p",
      },
    ],
    timeoutMin: 40,
  },
  {
    id: "genjutsu-object-swap",
    label: "Genjutsu · Object Swap",
    family: "genjutsu",
    tagline: "Swap specific things in a video — a product, an outfit, a prop — and keep the rest untouched.",
    path: "/higgsfiled/genjutsu/object-swap/v1.0",
    output: "video",
    // List rate (their console shows $0.318/s before the 50% promo); the
    // live estimate overrides this when it answers.
    listUsd: 0.318,
    unit: "second",
    prompt: "optional",
    images: {
      key: "image_urls",
      label: "Replacement objects (1–8 images)",
      min: 1,
      max: 8,
      helper: "What to swap in. Describe what to replace in the prompt.",
    },
    video: {
      key: "video_url",
      label: "Source video (4–30 s)",
      minSec: 4,
      maxSec: 30,
      helper: "Needs at least 640×640 frames. Longer clips are trimmed to 30 s.",
    },
    fields: [
      {
        key: "resolution",
        label: "Resolution",
        type: "select",
        options: opts(["720p", "480p"]),
        default: "720p",
      },
    ],
    timeoutMin: 40,
  },
  // Kling 3.0 Motion Control via Higgsfield — a character image performs
  // the motion (and lips) of a driving video. Output length = video length,
  // so it's billed per source second; /estimate returns the exact price
  // (fal doesn't publish this model's rate, which is why the fal Motion
  // tab hides 3.0). Verified fields 2026-09-23.
  ...(["std", "pro"] as const).map((tier): StudioModel => ({
    id: `kling-3-motion-control-${tier}`,
    label: `Kling 3.0 Motion Control · ${tier === "pro" ? "Pro" : "Standard"}`,
    family: "motion",
    tagline:
      tier === "pro"
        ? "Highest fidelity — complex movement, dance, full-body gestures."
        : "A character image performs the motion and speech of your video — talking heads, gestures.",
    path: `/kling-video/v3/motion-control/${tier}`,
    output: "video",
    // Fallback only — the live estimate is what gets billed.
    listUsd: tier === "pro" ? 0.112 : 0.084,
    unit: "second",
    prompt: "optional",
    image: {
      key: "image_url",
      label: "Character image",
      required: true,
      helper: "One person, face and upper body clearly visible, under 10 MB.",
    },
    video: {
      key: "video_url",
      label: "Motion video (3–30 s)",
      minSec: 3,
      maxSec: 30,
      helper: "The output follows this clip's length. Its audio is kept so lips stay in sync.",
    },
    fields: [
      {
        key: "character_orientation",
        label: "Scene control — follow the",
        type: "select",
        options: [
          { value: "video", label: "Motion video (complex motion, up to 30 s)" },
          { value: "image", label: "Character image (camera moves, up to 10 s)" },
        ],
        default: "video",
        helper: "Which reference leads the framing and movement.",
      },
      {
        key: "keep_original_sound",
        label: "Keep the video's sound",
        type: "select",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
        default: "yes",
      },
    ],
    timeoutMin: 40,
  })),
  {
    id: "kling-3-image-to-video",
    label: "Kling 3.0 · Image to video",
    family: "video",
    tagline: "Animate a still with native sound; optional end frame.",
    path: "/kling-video/v3.0/std/image-to-video",
    output: "video",
    listUsd: 0.084,
    unit: "second",
    prompt: "required",
    image: { key: "image_url", label: "Start image", required: true },
    endImage: { key: "last_image_url", label: "End frame (optional)" },
    duration: { min: 3, max: 15, default: 5 },
    fields: [
      {
        key: "sound",
        label: "Sound",
        type: "select",
        options: opts(["on", "off"], { on: "On", off: "Off" }),
        default: "on",
      },
    ],
    timeoutMin: 30,
  },
  {
    id: "kling-3-text-to-video",
    label: "Kling 3.0 · Text to video",
    family: "video",
    tagline: "Cinematic text-to-video with native sound.",
    path: "/kling-video/v3.0/std/text-to-video",
    output: "video",
    listUsd: 0.084,
    unit: "second",
    prompt: "required",
    duration: { min: 3, max: 15, default: 5 },
    fields: [
      {
        key: "aspect_ratio",
        label: "Aspect ratio",
        type: "select",
        options: opts(["16:9", "9:16", "1:1"]),
        default: "16:9",
      },
      {
        key: "sound",
        label: "Sound",
        type: "select",
        options: opts(["on", "off"], { on: "On", off: "Off" }),
        default: "on",
      },
    ],
    timeoutMin: 30,
  },
  {
    id: "seedance-2-5-image-to-video",
    label: "Seedance 2.5 · Image to video",
    family: "video",
    tagline: "ByteDance's flagship — up to 30 s, with audio; optional end frame.",
    path: "/bytedance/seedance-2.5/image-to-video",
    output: "video",
    // Token-metered: 720p 16:9 works out to $0.462/s (480p ≈ $0.206/s).
    listUsd: 0.462,
    unit: "second",
    prompt: "optional",
    image: { key: "image_url", label: "Start image", required: true },
    endImage: { key: "end_image_url", label: "End frame (optional)" },
    duration: { min: 4, max: 30, default: 5 },
    fields: [
      {
        key: "resolution",
        label: "Resolution",
        type: "select",
        options: opts(["720p", "480p"]),
        default: "720p",
      },
      audioToggle("generate_audio"),
    ],
    timeoutMin: 40,
  },
  {
    id: "seedance-2-5-text-to-video",
    label: "Seedance 2.5 · Text to video",
    family: "video",
    tagline: "ByteDance's flagship — up to 30 s, with audio.",
    path: "/bytedance/seedance-2.5/text-to-video",
    output: "video",
    // Token-metered: 720p 16:9 works out to $0.462/s (480p ≈ $0.206/s).
    listUsd: 0.462,
    unit: "second",
    prompt: "required",
    duration: { min: 4, max: 30, default: 5 },
    fields: [
      {
        key: "aspect_ratio",
        label: "Aspect ratio",
        type: "select",
        options: opts(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
        default: "16:9",
      },
      {
        key: "resolution",
        label: "Resolution",
        type: "select",
        options: opts(["720p", "480p"]),
        default: "720p",
      },
      audioToggle("generate_audio"),
    ],
    timeoutMin: 40,
  },
];

export const STUDIO_FAMILIES: { value: StudioFamily; label: string }[] = [
  { value: "image", label: "Images" },
  { value: "video", label: "Video" },
  { value: "genjutsu", label: "Genjutsu" },
  { value: "motion", label: "Motion control" },
];

export function findStudioModel(id: string): StudioModel | undefined {
  return STUDIO_MODELS.find((m) => m.id === id);
}

export type StudioInput = {
  prompt: string;
  options: Record<string, string | boolean>;
  /** Single-image models: [start, end?]; multi-image models: the list. */
  imageUrls: string[];
  videoUrl?: string;
  durationSec?: number;
  batch: number;
};

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim());
}

/**
 * Turn raw form values into a validated input: required media present,
 * every knob whitelisted against the catalog, numbers clamped. Throws
 * user-facing messages.
 */
export function normalizeStudioInput(
  model: StudioModel,
  raw: {
    prompt: string;
    options: Record<string, unknown>;
    imageUrls: string[];
    videoUrl?: string;
    durationSec?: number;
    batch?: number;
  },
): StudioInput {
  const prompt = raw.prompt.trim().slice(0, 2500);
  if (model.prompt === "required" && !prompt) throw new Error("Write a prompt first");

  const options: Record<string, string | boolean> = {};
  for (const field of model.fields) {
    const value = raw.options[field.key];
    if (field.type === "toggle") {
      options[field.key] = typeof value === "boolean" ? value : field.default;
    } else {
      const chosen =
        typeof value === "string" && field.options.some((o) => o.value === value)
          ? value
          : field.default;
      if (chosen !== undefined) options[field.key] = chosen;
    }
  }

  const imageUrls = raw.imageUrls.map((u) => u.trim()).filter(isHttpUrl);
  if (model.image?.required && !imageUrls[0]) {
    throw new Error(`Add the ${model.image.label.toLowerCase()} first`);
  }
  if (model.images && imageUrls.length < model.images.min) {
    throw new Error(
      model.images.min === 1
        ? "Add at least one reference image"
        : `Add at least ${model.images.min} reference images`,
    );
  }
  const maxImages = model.images ? model.images.max : model.endImage ? 2 : 1;

  const videoUrl = isHttpUrl(raw.videoUrl) ? raw.videoUrl.trim() : undefined;
  if (model.video && !videoUrl) throw new Error("Add the source video first");

  let durationSec: number | undefined;
  if (model.duration) {
    const requested = Number(raw.durationSec ?? model.duration.default);
    durationSec = Math.min(
      model.duration.max,
      Math.max(model.duration.min, Math.round(Number.isFinite(requested) ? requested : model.duration.default)),
    );
  } else if (model.video) {
    // Billed length = source length (checked against the file server-side).
    durationSec = raw.durationSec;
  }

  const batch =
    model.batch && raw.batch && model.batch.options.includes(raw.batch) ? raw.batch : 1;

  return {
    prompt,
    options,
    imageUrls: imageUrls.slice(0, maxImages),
    videoUrl,
    durationSec,
    batch,
  };
}

/** The request body Higgsfield expects for this model + input. */
export function buildStudioBody(
  model: StudioModel,
  input: StudioInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input.options };
  if (input.prompt) body.prompt = input.prompt;
  if (model.image && input.imageUrls[0]) body[model.image.key] = input.imageUrls[0];
  if (model.endImage && input.imageUrls[1]) body[model.endImage.key] = input.imageUrls[1];
  if (model.images && input.imageUrls.length > 0) body[model.images.key] = input.imageUrls;
  if (model.video && input.videoUrl) body[model.video.key] = input.videoUrl;
  if (model.duration && input.durationSec) body.duration = input.durationSec;
  if (model.batch) body[model.batch.key] = input.batch;
  return body;
}

/**
 * Higgsfield's token-metered video pricing (Cinema Studio, Seedance —
 * their /estimate returns this formula instead of a number):
 * tokens = ceil(seconds × width × height × 24 fps / 1024), $0.0214 per
 * 1,000 tokens at 480p/720p, before any customer discount. Image refs are
 * free; only generated seconds count for the models we expose.
 */
export const VIDEO_TOKEN_USD_PER_1K = 0.0214;

const SHORT_SIDE: Record<string, number> = { "480p": 480, "720p": 720 };
const RATIOS: Record<string, [number, number]> = {
  "16:9": [16, 9],
  "9:16": [9, 16],
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "21:9": [21, 9],
};

/** Output frame size for a resolution + aspect ratio, or null if unknown. */
export function frameDims(resolution: string, aspectRatio: string): [number, number] | null {
  const short = SHORT_SIDE[resolution];
  const ratio = RATIOS[aspectRatio];
  if (!short || !ratio) return null;
  const [w, h] = ratio;
  return w >= h
    ? [Math.round((short * w) / h), short]
    : [short, Math.round((short * h) / w)];
}

/** Formula price for a token-metered video job; null when it doesn't apply. */
export function tokenMeteredUsd(model: StudioModel, input: StudioInput): number | null {
  if (model.output !== "video") return null;
  const resolution = String(input.options.resolution ?? "720p");
  // Image-to-video models take the ratio from the image; 16:9 is the
  // largest of the common shapes, so it never under-counts.
  const aspect = String(input.options.aspect_ratio ?? "16:9");
  const dims = frameDims(resolution, aspect);
  const seconds = Math.ceil(input.durationSec ?? 0);
  if (!dims || seconds <= 0) return null;
  const tokens = Math.ceil((seconds * dims[0] * dims[1] * 24) / 1024);
  return (tokens / 1000) * VIDEO_TOKEN_USD_PER_1K;
}

/** Catalog (list-price) cost in USD — the fallback when /estimate is down. */
export function studioListUsd(model: StudioModel, input: StudioInput): number {
  if (model.unit === "image") return model.listUsd * input.batch;
  return model.listUsd * Math.max(1, Math.ceil(input.durationSec ?? 0));
}

/** Credits for a base USD cost at the platform markup. */
export function studioCreditsFromUsd(args: {
  baseUsd: number;
  markup: number;
  creditPriceUsd: number;
}): number {
  if (args.creditPriceUsd <= 0 || args.baseUsd <= 0) return 0;
  return Math.max(1, Math.ceil((args.baseUsd * args.markup) / args.creditPriceUsd));
}
