"use node";

import { action } from "./lib/functions";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { scopeValidator } from "./noteTakerAskData";
import { assertPlanAction } from "./lib/plan";
import { OUTPUT_LANGUAGES } from "../lib/note-taker";
import { fallbackKeywords, parseCitations } from "../lib/note-ask";

/**
 * Ask across meetings (the Ask bar). Question → search keywords (small,
 * fast model) → the meetings that match plus recent ones in scope → an
 * answer that cites [M3] / [M3 12:04], which the UI turns into links.
 */

const ANSWER_MODEL = "claude-opus-5";
const KEYWORD_MODEL = "claude-haiku-5-5";

const ASK_ALL_SYSTEM =
  "You answer questions about a team's meetings, using ONLY the meeting " +
  "records below (notes and, where shown, transcript moments). Each meeting " +
  "has a label like M3. Cite every claim: [M3] for a meeting, or [M3 12:04] " +
  "for a moment when a timestamped line supports it — copy the label and " +
  "time exactly as shown. Be direct and brief: a sentence or two, then " +
  "bullets if listing. Group action items by owner when asked. If the " +
  "records don't contain the answer, say so plainly — never guess, never " +
  "bring in outside facts, never invent owners or dates. Plain text, no " +
  "headings.";

function aiFailure(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : "";
  if (/credit balance|billing/i.test(message)) {
    return "Ask is paused — the platform's AI account is out of credits.";
  }
  if (status === 429 || status === 529 || /rate.?limit|overloaded/i.test(message)) {
    return "The AI is busy right now — try again in a minute.";
  }
  return "Couldn't get an answer right now.";
}

type Anthropic = InstanceType<typeof import("@anthropic-ai/sdk").default>;

async function searchKeywords(client: Anthropic, question: string): Promise<string[]> {
  try {
    const response = await client.messages.create({
      model: KEYWORD_MODEL,
      max_tokens: 200,
      system:
        "Turn the question into 2–6 search keywords for full-text search over " +
        "meeting notes and transcripts: names, companies, products, topics. " +
        "Skip filler (meeting, decide, week). Reply with a JSON array of strings only.",
      messages: [{ role: "user", content: question }],
    });
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    const parsed: unknown = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    if (Array.isArray(parsed)) {
      const words = parsed.filter((w): w is string => typeof w === "string" && w.trim().length > 1);
      if (words.length > 0) return words.slice(0, 6);
    }
  } catch {
    // Fall through to the plain-word fallback.
  }
  return fallbackKeywords(question);
}

export const ask = action({
  args: {
    threadId: v.optional(v.id("noteAskThreads")),
    scope: scopeValidator,
    question: v.string(),
  },
  handler: async (ctx, args): Promise<{ threadId: Id<"noteAskThreads"> }> => {
    const question = args.question.trim().slice(0, 2000);
    if (!question) throw new Error("Ask a question first");
    const me = await ctx.runQuery(internal.noteTakerAskData.askCaller, {
      threadId: args.threadId,
    });
    if (!me) throw new Error("Not signed in");
    await assertPlanAction(ctx, "personal", "AI Note Taker");
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("NOT_CONFIGURED: Ask needs ANTHROPIC_API_KEY.");
    }
    // Unmetered, big model, many meetings in context — cap per user.
    await ctx.runMutation(internal.rateLimits.hit, {
      key: `noteTakerAskAll:${me.userId}`,
      limit: 40,
      windowMs: 60 * 60_000,
    });

    const threadId =
      args.threadId ??
      (await ctx.runMutation(internal.noteTakerAskData.startThread, {
        workspaceId: me.workspaceId,
        userId: me.userId,
        title: question.slice(0, 80),
        scope: args.scope,
      }));
    await ctx.runMutation(internal.noteTakerAskData.addMessage, {
      threadId,
      role: "user",
      content: question,
    });
    const reply = async (content: string, citations?: ReturnType<typeof parseCitations>) =>
      await ctx.runMutation(internal.noteTakerAskData.addMessage, {
        threadId,
        role: "assistant",
        content,
        ...(citations && {
          citations: citations.map((c) => ({ ...c, meetingId: c.meetingId as Id<"meetings"> })),
        }),
      });

    const { default: AnthropicSdk } = await import("@anthropic-ai/sdk");
    const client = new AnthropicSdk();
    // Follow-ups lean on the earlier question for their keywords.
    const lastQuestion = [...me.history].reverse().find((m) => m.role === "user")?.content;
    const keywords = await searchKeywords(
      client,
      lastQuestion ? `${lastQuestion}\nFollow-up: ${question}` : question,
    );
    const { corpus, labels } = await ctx.runQuery(internal.noteTakerAskData.askCorpus, {
      workspaceId: me.workspaceId,
      scope: args.scope,
      keywords,
    });
    if (!corpus) {
      await reply(
        "I couldn't find any finished meetings to answer from here. Once meetings have notes, ask again.",
      );
      return { threadId };
    }

    const language =
      me.outputLanguage !== "auto" && OUTPUT_LANGUAGES[me.outputLanguage]
        ? `\nAnswer in ${OUTPUT_LANGUAGES[me.outputLanguage]}.`
        : "";
    const history = [...me.history];
    while (history.length > 0 && history[0].role !== "user") history.shift();
    try {
      const response = await client.messages.create({
        model: ANSWER_MODEL,
        max_tokens: 3000,
        system: [
          { type: "text", text: ASK_ALL_SYSTEM + language },
          {
            type: "text",
            text: `Today is ${new Date().toISOString().slice(0, 10)}.\n\n${corpus}`,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [...history, { role: "user" as const, content: question }],
      });
      const answer = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n")
        .trim();
      if (response.stop_reason === "refusal" || !answer) {
        await reply("I couldn't answer that from your meetings.");
      } else {
        await reply(answer, parseCitations(answer, labels));
      }
    } catch (error) {
      console.error("Note taker: ask-all failed", error);
      await reply(aiFailure(error));
    }
    return { threadId };
  },
});
