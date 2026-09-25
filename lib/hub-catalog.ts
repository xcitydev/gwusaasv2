import { IMAGE_MODELS, MOTION_MODELS, MOTION_MAX_SECONDS, VIDEO_MODELS } from "@/lib/ai-models";
import { STUDIO_MODELS } from "@/lib/studio-models";
import type { HubMode } from "@/lib/hub-tools";

/**
 * What the AI Hub agent knows about our models. Built from the same catalogs
 * the forms use, so it can never propose a model or option we don't offer.
 * Prices are described relatively — the exact credits come from `estimate`.
 */

const IMAGE_HINTS: Record<string, string> = {
  "flux-pro-1.1": "default photoreal/general images, strong prompt following",
  "flux-dev": "cheapest, fast drafts",
  "recraft-v3": "design, vector-like, illustration and brand graphics",
  "ideogram-v3": "when the image must contain readable TEXT (posters, labels)",
  "nano-banana-edit": "EDIT an existing image (needs referenceUrl): change, restyle, remove, combine",
};

const VIDEO_HINTS: Record<string, string> = {
  "kling-2.5-turbo-pro": "default video: cinematic, good motion, cheap; text-to-video or animate a reference image",
  "veo-3-fast": "native AUDIO/dialogue, top realism; expensive; fixed 8 s",
  "seedance-1-pro": "stylized/creative motion, good for products and people",
  "luma-ray-2": "smooth camera moves, dreamy looks",
  "hailuo-02": "cheapest video, decent quality, 6/10 s",
};

function falSection(): string {
  const images = IMAGE_MODELS.map(
    (m) => `- ${m.id} (${m.label}) — ~$${m.baseUsd}/image base · sizes: ${m.resolutions.join(", ")} · ${IMAGE_HINTS[m.id] ?? ""}`,
  );
  const videos = VIDEO_MODELS.map(
    (m) =>
      `- ${m.id} (${m.label}) — ~$${m.perSecondUsd}/s base · durations: ${m.durations.join("/")} s · resolutions: ${m.resolutions.join(", ")} · ${m.supportsReference ? "supports a start/reference image (referenceUrl)" : "text only"} · ${VIDEO_HINTS[m.id] ?? ""}`,
  );
  const motion = MOTION_MODELS.filter((m) => m.available).map(
    (m) => `- ${m.id} (${m.label}) — ~$${m.perSecondUsd}/s of driving video · ${m.hint}`,
  );
  return [
    "### kind=image (fal) — landscape/portrait via the size string",
    ...images,
    "",
    "### kind=video (fal) — no aspect ratio control; use Studio for vertical (9:16) video",
    ...videos,
    "",
    `### kind=motion (fal Kling Motion Control) — needs referenceUrl (character IMAGE) + videoUrl (driving VIDEO); the person in the image performs the video's motion and lips; characterOrientation "image" keeps the image background (max ${MOTION_MAX_SECONDS.image} s of video), "video" keeps the video background (max ${MOTION_MAX_SECONDS.video} s). Price = per second of the driving video.`,
    ...motion,
  ].join("\n");
}

function studioSection(): string {
  const lines: string[] = [
    "### kind=studio (Higgsfield) — pass knobs in `options` by field key; pass aspectRatio/resolution as top-level fields",
  ];
  for (const m of STUDIO_MODELS) {
    const inputs: string[] = [];
    if (m.prompt === "required") inputs.push("prompt required");
    if (m.prompt === "optional") inputs.push("prompt optional");
    if (m.image) {
      inputs.push(`imageUrls[0] ${m.image.required ? "REQUIRED" : "optional"} (${m.image.label})`);
    }
    if (m.endImage) inputs.push(`imageUrls[1] optional (${m.endImage.label})`);
    if (m.images) {
      inputs.push(
        `imageUrls ${m.images.min > 0 ? "REQUIRED" : "optional"} (${m.images.min}–${m.images.max}: ${m.images.label})`,
      );
    }
    if (m.video) inputs.push(`videoUrl REQUIRED (${m.video.label}, ${m.video.minSec}–${m.video.maxSec} s, billed per second)`);
    if (m.duration) inputs.push(`durationSec ${m.duration.min}–${m.duration.max} (default ${m.duration.default})`);
    if (m.batch) inputs.push(`batch ${m.batch.options.join("/")}`);
    const fields = m.fields
      .map((f) => {
        if (f.type === "select") {
          const values = f.options.map((o) => o.value);
          const shown = values.length > 12 ? `${values.slice(0, 12).join("|")}|… (${values.length} total)` : values.join("|");
          return `${f.key}${f.optional ? "?" : ""}=[${shown}]`;
        }
        return `${f.key}=true|false`;
      })
      .join("; ");
    const price =
      m.unit === "image"
        ? `~$${m.listUsd}/image`
        : `~$${m.listUsd}/s list (720p; 480p is about half)`;
    lines.push(`- ${m.id} (${m.label}) — ${m.output} · ${price} · ${m.tagline}`);
    lines.push(`    inputs: ${inputs.join("; ")}`);
    if (fields) lines.push(`    options: ${fields}`);
  }
  return lines.join("\n");
}

export const HUB_CATALOG = `${falSection()}\n\n${studioSection()}`;

const MODE_NOTES: Record<HubMode, string> = {
  auto: "Balance cost and quality: cheap models for drafts and simple asks, premium ones when the request clearly needs them.",
  fast: "The user chose FAST: prefer the cheapest suitable model, 480p / standard tiers, shorter durations, single images.",
  quality:
    "The user chose QUALITY: prefer premium models (Veo 3, Kling 3.0, Cinema Studio, Soul 2 1080p), 720p+/pro tiers.",
};

export function buildHubSystemPrompt(mode: HubMode): string {
  return `You are the AI Hub for GWU (Grow With Us), a creative agent inside a marketing platform. The user chats; you decide which generation tool fits, price it, and propose it. Nothing renders until they tap Run on your plan card.

## Workflow — every time the user wants something made
1. Work out what they want: image, video, motion transfer (a person in a photo copying a video), or a Studio job (Higgsfield models — vertical video, Cinema Studio direction, Soul 2 photoreal images, Genjutsu motion/object transfer, Kling 3.0, Seedance 2.5).
2. Write the prompt yourself: specific subject, setting, light, camera, mood, style. Keep their intent; never water it down.
3. Call estimate with the candidate settings. If it returns an error (missing image/video, invalid option), ask the user for what's missing instead of guessing.
4. Call propose ONCE with the same settings and the credits figure. Then stop and wait — do not describe the result as if it exists.
5. After their decision arrives: run → say it's rendering and will appear in the card (one short line); cancel → ask what to change; change → adjust and go back to step 3.

## Routing rules
- Attachments arrive as lines like "[Attached image: URL]" / "[Attached video: URL]". One image + "animate/move/bring to life" → kind=video with referenceUrl (fal) or a Studio image-to-video with imageUrls. One image + one video (or words like "copy this dance / lip-sync / make me do this") → kind=motion, referenceUrl=image, videoUrl=video. Several images + a video → Studio genjutsu. An image + "edit/change/remove/restyle" → nano-banana-edit with referenceUrl. Text mentioning readable words on the image → ideogram-v3.
- Vertical/9:16/Reels/TikTok/Story video → Studio (kling-3-text-to-video, seedance-2-5-*, cinema-studio-4) with aspectRatio "9:16"; fal video models cannot do vertical.
- Dialogue or sound in the video → veo-3-fast, kling-3 (sound on) or seedance-2-5 (generate_audio true); otherwise leave audio off to save credits.
- "Cinematic / directed / specific lens, camera move, palette" → cinema-studio-4 with those options.
- Photoreal people, fashion, editorial → soul-2. Product mockups, posters, brand graphics → recraft-v3 or flux-pro-1.1.
- If the user names a model, use it. If they say "same but …", reuse the previous plan's settings and change only what they asked.
- Anything over ~300 credits: mention the cost plainly and, when sensible, offer a cheaper draft first (480p / shorter / flux-dev) — but still propose what they asked for.
- Not enough credits: still propose (the card shows what's missing) and tell them where to top up (Settings → Billing).
- Requests outside generation (captions, ideas, advice): just answer, briefly.
- Never invent models, options or prices. Never call propose without estimate. Never spend credits without the card.

## Mode
${MODE_NOTES[mode]}

## Tone
Short, confident, no fluff. One or two sentences around a card. No markdown headers. Plain language for beginners — explain a model choice in a few words, not a lecture.

## Catalog (ids are exact)
${HUB_CATALOG}`;
}
