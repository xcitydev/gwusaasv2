import { streamText, convertToModelMessages } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { buildHubSystemPrompt } from "@/lib/hub-catalog";
import { hubTools, HUB_MODES, type HubMode, type HubUIMessage } from "@/lib/hub-tools";

export const maxDuration = 60;

// Bounded context: the last 30 messages, each text part ≤ 8,000 characters,
// and a hard ceiling on the whole payload (attachments travel as URLs).
const MAX_MESSAGES = 30;
const MAX_PART_CHARS = 8000;
const MAX_TOTAL_CHARS = 300_000;

function capMessages(messages: HubUIMessage[]): HubUIMessage[] {
  return messages.slice(-MAX_MESSAGES).map((m) => ({
    ...m,
    parts: (m.parts ?? []).map((p) =>
      p.type === "text" && p.text.length > MAX_PART_CHARS
        ? { ...p, text: p.text.slice(0, MAX_PART_CHARS) }
        : p,
    ),
  })) as HubUIMessage[];
}

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
  // No setup-mode bypass: without Clerk there is no identity to rate-limit.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  const { userId, getToken } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  // Per-user budget, keyed server-side from the Convex identity (the
  // mutation also refuses locked accounts).
  const token = await getToken({ template: "convex" });
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    await fetchMutation(api.rateLimits.hitChat, { bucket: "hubChat" }, { token });
  } catch (e) {
    const text = e instanceof Error ? e.message : "";
    const limited = /RATE_LIMITED/.test(text);
    return Response.json(
      { error: limited ? "rate_limited" : "unauthorized" },
      { status: limited ? 429 : 403 },
    );
  }

  const body = (await req.json()) as { messages?: HubUIMessage[]; mode?: string };
  if (!Array.isArray(body.messages)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const mode: HubMode = HUB_MODES.includes(body.mode as HubMode)
    ? (body.mode as HubMode)
    : "auto";
  const messages = capMessages(body.messages);
  if (JSON.stringify(messages).length > MAX_TOTAL_CHARS) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }

  const result = streamText({
    model: anthropic("claude-opus-5"),
    system: buildHubSystemPrompt(mode),
    messages: await convertToModelMessages(messages),
    tools: hubTools,
  });

  return result.toUIMessageStreamResponse();
}
