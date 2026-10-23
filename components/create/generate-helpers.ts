import { toast } from "sonner";
import { promptTopUpIfInsufficient } from "@/lib/top-up-prompt";
import { errorText } from "@/lib/public-errors";

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
    toast.error("The generation engine isn't connected yet — please try again later or contact support.");
  } else if (promptTopUpIfInsufficient(error, "This generation")) {
    // The top-up dialog is open with the exact gap; no toast needed.
  } else if (message.includes("refunded")) {
    toast.error("Generation failed — your credits were refunded.");
  } else {
    toast.error("Generation failed. Are you signed in?");
  }
}

/** The user-safe sentence for a caught error (no wrappers, no vendor names). */
export function cleanErrorMessage(error: unknown, fallback: string): string {
  return errorText(error, fallback);
}
