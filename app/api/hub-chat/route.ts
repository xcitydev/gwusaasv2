import { streamText, convertToModelMessages } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { auth } from "@clerk/nextjs/server";
import { buildHubSystemPrompt } from "@/lib/hub-catalog";
import { hubTools, HUB_MODES, type HubMode, type HubUIMessage } from "@/lib/hub-tools";

export const maxDuration = 60;

/**
 * The AI Hub agent. One model turn per request: it reasons, calls estimate /
 * propose / recentGenerations (all executed on the client, which then sends
 * the results back), and replies. Credits are only spent client-side after
 * the user taps Run on a plan card.
 */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { messages: HubUIMessage[]; mode?: string };
  const mode: HubMode = HUB_MODES.includes(body.mode as HubMode)
    ? (body.mode as HubMode)
    : "auto";
  // Keep the context bounded: the last 30 messages are plenty for iteration.
  const messages = body.messages.slice(-30);

  const result = streamText({
    model: anthropic("claude-opus-5"),
    system: buildHubSystemPrompt(mode),
    messages: await convertToModelMessages(messages),
    tools: hubTools,
  });

  return result.toUIMessageStreamResponse();
}
