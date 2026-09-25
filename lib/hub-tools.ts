import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { z } from "zod";

/**
 * The AI Hub agent's tool belt. Every tool is executed on the CLIENT: pricing
 * and the user's balance need their Convex session, and `propose` is a
 * human-in-the-loop card — the model waits for the tap. Nothing here spends
 * credits; the client only calls a generate action after the user says run.
 */

export const hubKind = z.enum(["image", "video", "motion", "studio"]);
export type HubKind = z.infer<typeof hubKind>;

const optionValue = z.union([z.string(), z.boolean(), z.number()]);

const generationFields = {
  kind: hubKind,
  modelId: z.string().describe("A model id from the catalog"),
  resolution: z
    .string()
    .optional()
    .describe("fal image: a size from the catalog (e.g. 1024×1440); fal video: 720p/1080p; Studio: 720p or 480p"),
  aspectRatio: z.string().optional().describe("Studio only, e.g. 9:16 or 16:9"),
  durationSec: z.number().optional().describe("Video length in seconds (for motion/genjutsu: the source video length if known)"),
  referenceUrl: z.string().optional().describe("fal: start/reference image URL; motion: the character image URL"),
  imageUrls: z.array(z.string()).optional().describe("Studio: reference / start [+ end] image URLs"),
  videoUrl: z.string().optional().describe("Driving or source video URL (motion control, genjutsu)"),
  characterOrientation: z
    .enum(["image", "video"])
    .optional()
    .describe("Motion control: keep the background of the image or of the video"),
  options: z
    .record(z.string(), optionValue)
    .optional()
    .describe("Studio knobs by field key (genre, camera_movement, sound, generate_audio…)"),
  batch: z.number().optional().describe("Studio images only: 1 or 4"),
};

export const estimateInputSchema = z.object(generationFields);
export const estimateOutputSchema = z.object({
  credits: z.number().optional(),
  usd: z.number().optional(),
  exact: z.boolean().optional(),
  balance: z.number(),
  enough: z.boolean().optional(),
  note: z.string().optional(),
  error: z.string().optional(),
});

export const proposeInputSchema = z.object({
  title: z.string().describe("Short name for the result, e.g. 'Vertical product clip'"),
  reason: z.string().describe("One sentence: why this model and these settings"),
  prompt: z.string().describe("The final prompt to send to the model — polished, specific"),
  credits: z.number().describe("The credits figure from estimate"),
  ...generationFields,
});
export const proposeOutputSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("run") }),
  z.object({ decision: z.literal("cancel") }),
  z.object({ decision: z.literal("change"), note: z.string() }),
]);

export const recentInputSchema = z.object({
  limit: z.number().min(1).max(20).optional().describe("Default 8"),
});
export const recentOutputSchema = z.array(
  z.object({
    id: z.string(),
    kind: z.string(),
    model: z.string(),
    prompt: z.string(),
    status: z.string(),
    url: z.string().nullable(),
  }),
);

export const hubTools = {
  estimate: tool({
    description:
      "Price one candidate generation in credits against the user's balance. Call it before propose; call it more than once to compare options. Returns an error message when required inputs are missing.",
    inputSchema: estimateInputSchema,
    outputSchema: estimateOutputSchema,
  }),
  propose: tool({
    description:
      "Show the user a plan card (model, settings, exact credits) and wait for their decision. Exactly one per turn, only after estimate. This is the ONLY way anything gets generated.",
    inputSchema: proposeInputSchema,
    outputSchema: proposeOutputSchema,
  }),
  recentGenerations: tool({
    description:
      "The user's latest results (id, kind, model, prompt, status, url). Use it when they refer to something they made before, e.g. 'animate the last image'.",
    inputSchema: recentInputSchema,
    outputSchema: recentOutputSchema,
  }),
};

export type HubTools = InferUITools<typeof hubTools>;
export type HubUIMessage = UIMessage<never, UIDataTypes, HubTools>;

export type HubPlan = z.infer<typeof proposeInputSchema>;
export type HubEstimateInput = z.infer<typeof estimateInputSchema>;
export type HubEstimateOutput = z.infer<typeof estimateOutputSchema>;
export type HubProposeOutput = z.infer<typeof proposeOutputSchema>;

export const HUB_MODES = ["auto", "fast", "quality"] as const;
export type HubMode = (typeof HUB_MODES)[number];
