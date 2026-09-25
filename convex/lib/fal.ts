/**
 * Shared fal.ai queue runner — used by Create with AI and the carousel
 * generator (both runtimes; only fetch/setTimeout needed).
 */
/**
 * Submit to fal.ai's queue API and poll until the output is ready.
 * Live-verified quirks: the queue accepts ANY subpath at submit time and only
 * resolves it when the worker runs — a bad route "completes" instantly with a
 * 404 body as its result. So errors here always carry fal's own words, and
 * queue URLs come from the submit response (they drop model subpaths).
 */
export async function runFal(
  provider: string,
  input: {
    prompt: string;
    resolution: string;
    durationSec?: number;
    referenceUrl?: string;
    kind: "image" | "video" | "motion";
    /** Motion control: the driving video + whose background to keep. */
    videoUrl?: string;
    characterOrientation?: "image" | "video";
  },
  onRequestId?: (requestId: string) => Promise<void>,
): Promise<string> {
  const key = process.env.FAL_KEY!;
  const headers = {
    Authorization: `Key ${key}`,
    "Content-Type": "application/json",
  };

  const [width, height] = input.resolution.includes("×")
    ? input.resolution.split("×").map(Number)
    : [undefined, undefined];

  const body: Record<string, unknown> =
    input.kind === "motion"
      ? {
          // Kling motion control: character image + driving video. The
          // video's own audio is kept so lips stay in sync with the sound.
          image_url: input.referenceUrl,
          video_url: input.videoUrl,
          character_orientation: input.characterOrientation ?? "video",
          keep_original_sound: true,
          ...(input.prompt.trim() && { prompt: input.prompt.trim() }),
        }
      : { prompt: input.prompt };
  if (input.kind === "image") {
    if (input.referenceUrl) {
      // Editing models (nano-banana) take the source image as a list.
      body.image_urls = [input.referenceUrl];
    } else if (width && height) {
      body.image_size = { width, height };
    }
  }
  if (input.kind === "video") {
    if (input.durationSec) body.duration = String(input.durationSec);
    if (input.resolution) body.resolution = input.resolution;
    if (input.referenceUrl) body.image_url = input.referenceUrl;
  }

  const submit = await fetch(`https://queue.fal.run/${provider}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    const text = await submit.text();
    throw new Error(`fal submit ${submit.status}: ${text.slice(0, 300)}`);
  }
  const { request_id, status_url, response_url } = (await submit.json()) as {
    request_id: string;
    status_url?: string;
    response_url?: string;
  };
  await onRequestId?.(request_id);

  // Fallbacks use the BASE app path (first two segments) — subpaths 404.
  const baseApp = provider.split("/").slice(0, 2).join("/");
  const statusUrl =
    status_url ?? `https://queue.fal.run/${baseApp}/requests/${request_id}/status`;
  const responseUrl =
    response_url ?? `https://queue.fal.run/${baseApp}/requests/${request_id}`;

  // Poll up to ~8 minutes (video can be slow); motion control gets ~9 —
  // the most the 10-minute action cap allows.
  const maxPolls = input.kind === "motion" ? 180 : 160;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const statusRes = await fetch(statusUrl, { headers });
    if (!statusRes.ok) continue;
    const { status } = (await statusRes.json()) as { status: string };
    if (status === "COMPLETED") {
      const resultRes = await fetch(responseUrl, { headers });
      const raw = await resultRes.text();
      if (!resultRes.ok) {
        throw new Error(`fal result ${resultRes.status}: ${raw.slice(0, 300)}`);
      }
      const result = JSON.parse(raw) as {
        images?: { url: string }[];
        image?: { url: string };
        video?: { url: string };
        detail?: unknown;
      };
      const url =
        result.images?.[0]?.url ?? result.image?.url ?? result.video?.url;
      if (!url) {
        throw new Error(
          `fal returned no output: ${JSON.stringify(result.detail ?? result).slice(0, 300)}`,
        );
      }
      return url;
    }
    if (status === "FAILED" || status === "ERROR") {
      throw new Error("The model failed to generate");
    }
  }
  throw new Error("Generation timed out");
}
