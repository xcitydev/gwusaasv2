import { toast } from "sonner";

/** Length of a video file/URL from its metadata; null if it won't load. */
export function probeVideoDuration(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const seconds = video.duration;
      resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    };
    video.onerror = () => resolve(null);
    video.src = src;
  });
}

/** Turns the generate actions' error codes into a human toast. */
export function handleGenerateError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("NOT_CONFIGURED")) {
    toast.error("The generation engine isn't connected yet — an admin needs to add the provider key.");
  } else if (message.includes("INSUFFICIENT_CREDITS")) {
    toast.error("Not enough credits — top up in Settings.");
  } else if (message.includes("refunded")) {
    toast.error("Generation failed — your credits were refunded.");
  } else {
    toast.error("Generation failed. Are you signed in?");
  }
}

/** Strips Convex's "Uncaught Error:" prefix so users see the real sentence. */
export function cleanErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  const cleaned = message.split("Uncaught Error: ").pop()?.split("\n")[0]?.trim();
  return cleaned || fallback;
}
