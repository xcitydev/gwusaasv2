"use node";

import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { z } from "zod";

/**
 * IG DM intelligence: triage on every inbound (priority / stage / next
 * action), copilot drafts in the client's own voice, and autopilot with
 * guardrails. Node runtime for the Anthropic SDK; everything degrades
 * gracefully when ANTHROPIC_API_KEY isn't set on the deployment.
 */

const MODEL = "claude-opus-5";

/** Autopilot only answers messages this fresh — never backfilled history. */
const AUTOPILOT_MAX_AGE_MS = 30 * 60 * 1000;

const triageSchema = z.object({
  priority: z.enum(["hot", "warm", "cold"]),
  stage: z.enum(["new", "qualified", "booking_ready", "customer", "not_fit"]),
  // Imperative, ≤ 8 words: "Send booking link", "Follow up in 2 days".
  nextAction: z.string(),
});

const autopilotSchema = z.object({
  // The DM to send, or null when nothing should go out.
  reply: z.string().nullable(),
  // True = stand down and hand the thread to a human.
  escalate: z.boolean(),
  escalateReason: z.string().nullable(),
});

type VoiceProfile = Record<string, string> | null;

type ThreadMessage = {
  direction: "inbound" | "outbound";
  body: string;
  sentAt: number;
  sentBy: "human" | "ai" | null;
  kind: "text" | "voice";
};

type CopilotContext = {
  conversation: {
    _id: Id<"igConversations">;
    contactName?: string;
    lastDirection?: "inbound" | "outbound";
    needsHuman?: boolean;
    stage?: string;
  };
  account: {
    autopilot: boolean;
    aiBrief: string;
    bookingLink: string;
    igUsername: string | null;
  };
  workspaceName: string;
  voiceProfile: VoiceProfile;
  messages: ThreadMessage[];
};

const TRIAGE_SYSTEM =
  "You triage Instagram DM conversations for a business. Read the thread " +
  "and classify it.\n" +
  "priority — hot: clear buying intent or asking to book/pricing now; " +
  "warm: genuine interest, still exploring; cold: vague, spam, or no " +
  "intent.\n" +
  "stage — new: first contact, intent unclear; qualified: they've said " +
  "what they want and it fits the business; booking_ready: they asked how " +
  "to book, pricing, or availability — send the booking link; customer: " +
  "already bought / existing client; not_fit: wrong audience, spam, " +
  "solicitation, or declined.\n" +
  "nextAction — the single next move for a human setter, imperative, at " +
  "most 8 words (e.g. 'Send booking link', 'Answer pricing question', " +
  "'Follow up in 2 days', 'No action needed'). Never invent facts.";

function transcript(messages: ThreadMessage[], contactName?: string): string {
  const lead = contactName ? `Lead (${contactName})` : "Lead";
  return messages
    .map((m) => {
      const who =
        m.direction === "inbound"
          ? lead
          : m.sentBy === "ai"
            ? "You (AI autopilot)"
            : m.kind === "voice"
              ? "You (voice note)"
              : "You";
      return `${who}: ${m.body}`;
    })
    .join("\n");
}

/** The persona: the client's own voice intake + the facts they've allowed. */
function voiceSystemPrompt(data: CopilotContext): string {
  const p = data.voiceProfile ?? {};
  const handle = p.igHandle ?? data.account.igUsername;
  const lines = [
    `You write Instagram DM replies on behalf of ${
      handle ? `@${handle.replace(/^@/, "")}` : data.workspaceName || "a business"
    }${p.niche ? ` (${p.niche})` : ""}.`,
  ];
  if (data.voiceProfile) {
    lines.push(
      "Voice profile — from the client's own intake, mirror it exactly:",
      p.tone ? `- Tone: ${p.tone}` : "",
      p.length ? `- Length: ${p.length}` : "",
      p.emojiLevel ? `- Emoji: ${p.emojiLevel}` : "",
      p.likedExamples
        ? `- Messages they love (match this style):\n${p.likedExamples}`
        : "",
      p.avoidList ? `- Never say / avoid: ${p.avoidList}` : "",
      p.notes ? `- Notes: ${p.notes}` : "",
    );
  } else {
    lines.push(
      "No voice profile on file: write warm, natural and concise, like a " +
        "friendly business owner texting.",
    );
  }
  lines.push(
    "Business brief — the ONLY facts you may state (offers, prices, FAQs):",
    data.account.aiBrief ||
      "(none provided — stay general, never quote prices or specifics)",
    `Booking link: ${
      data.account.bookingLink ||
      "(none — offer to set up a call and ask for the best number or email)"
    }`,
    "Rules: this is an Instagram DM — 1 to 3 short sentences, " +
      "conversational, no greeting line, no sign-off, no subject. Answer " +
      "what they asked, then move one step toward a booked call; when " +
      "they're qualified or ask about pricing/availability, send the " +
      "booking link. Never invent prices, availability or promises that " +
      "aren't in the brief. Reply in the lead's language.",
  );
  return lines.filter(Boolean).join("\n");
}

/**
 * Classify a conversation after an inbound message; then, if autopilot is
 * on and the lead is waiting, answer (or hand off to a human).
 */
export const triageConversation = internalAction({
  args: { conversationId: v.id("igConversations") },
  handler: async (ctx, args): Promise<void> => {
    if (!process.env.ANTHROPIC_API_KEY) return;
    const data = (await ctx.runQuery(internal.igDms.getTriageContext, {
      conversationId: args.conversationId,
    })) as CopilotContext | null;
    if (!data || data.messages.length === 0) return;
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
      const client = new Anthropic();
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 400,
        system: TRIAGE_SYSTEM,
        messages: [
          {
            role: "user",
            content:
              `Business brief:\n${data.account.aiBrief || "(none)"}\n\n` +
              `Conversation (oldest first):\n${transcript(
                data.messages,
                data.conversation.contactName,
              )}`,
          },
        ],
        output_config: { format: zodOutputFormat(triageSchema), effort: "low" },
      });
      const triage = response.parsed_output;
      if (!triage) return;
      await ctx.runMutation(internal.igDms.setTriage, {
        conversationId: args.conversationId,
        priority: triage.priority,
        stage: triage.stage,
        nextAction: triage.nextAction.trim().slice(0, 80),
      });
      if (shouldAutopilot(data)) await runAutopilot(ctx, data);
    } catch (error) {
      console.error("IG triage failed:", error);
    }
  },
});

/**
 * Maintenance sweep: classify every conversation the AI has never seen
 * (e.g. history synced before triage existed). Staggered so a big backlog
 * doesn't burst the API. Autopilot never fires here — its freshness guard
 * only answers messages minutes old.
 */
export const triageBacklog = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const ids = await ctx.runQuery(internal.igDms.listUntriaged, {});
    for (const [index, conversationId] of ids.entries()) {
      await ctx.scheduler.runAfter(
        index * 1500,
        internal.igAi.triageConversation,
        { conversationId },
      );
    }
    return { scheduled: ids.length };
  },
});

function shouldAutopilot(data: CopilotContext): boolean {
  if (!data.account.autopilot || !data.account.aiBrief.trim()) return false;
  if (data.conversation.lastDirection !== "inbound") return false;
  if (data.conversation.needsHuman) return false;
  const lastInbound = [...data.messages]
    .reverse()
    .find((m) => m.direction === "inbound");
  return Boolean(
    lastInbound && Date.now() - lastInbound.sentAt < AUTOPILOT_MAX_AGE_MS,
  );
}

async function runAutopilot(ctx: ActionCtx, data: CopilotContext): Promise<void> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 800,
    system:
      voiceSystemPrompt(data) +
      "\n\nYou are on AUTOPILOT: decide whether to reply or hand off. Set " +
      "escalate=true (reply=null, with a one-line escalateReason) when the " +
      "lead asks for anything the brief doesn't cover (prices or details " +
      "not listed), complains, is upset, mentions refunds/legal/medical/" +
      "safety specifics, asks for a real person, or needs a decision only " +
      "the owner can make. If the last message needs no reply at all " +
      "(e.g. 'ok thanks', spam), return reply=null and escalate=false. " +
      "Otherwise reply=the DM to send.",
    messages: [
      {
        role: "user",
        content:
          `Conversation (oldest first):\n${transcript(
            data.messages,
            data.conversation.contactName,
          )}\n\nDecide.`,
      },
    ],
    output_config: { format: zodOutputFormat(autopilotSchema) },
  });
  const decision = response.parsed_output;
  if (!decision) return;
  if (decision.escalate) {
    await ctx.runMutation(internal.igDms.flagNeedsHuman, {
      conversationId: data.conversation._id,
      reason: decision.escalateReason?.trim() || "Outside the brief",
    });
    return;
  }
  const reply = decision.reply?.trim();
  if (!reply) return;
  // Re-check right before sending: the webhook and the cron sync can both
  // trigger triage for one message, and a human may have answered meanwhile.
  const fresh = (await ctx.runQuery(internal.igDms.getTriageContext, {
    conversationId: data.conversation._id,
  })) as CopilotContext | null;
  if (!fresh || !shouldAutopilot(fresh)) return;
  await ctx.runAction(internal.igDmsActions.sendSystemReply, {
    conversationId: data.conversation._id,
    text: reply,
  });
}

/** Copilot: draft the next reply for the setter to edit or send. */
export const suggestDmReply = action({
  args: { conversationId: v.id("igConversations") },
  handler: async (ctx, args): Promise<string> => {
    const data = (await ctx.runQuery(internal.igDms.getCopilotContext, {
      conversationId: args.conversationId,
    })) as CopilotContext | null;
    if (!data) throw new Error("Conversation not found");
    if (data.messages.length === 0) throw new Error("Nothing to reply to yet");

    if (!process.env.ANTHROPIC_API_KEY) {
      const name = data.conversation.contactName?.split(" ")[0];
      return (
        `Hey${name ? ` ${name}` : ""}! Thanks for reaching out — happy to ` +
        `help. ${
          data.account.bookingLink
            ? `Easiest next step is to grab a quick call here: ${data.account.bookingLink}`
            : "What's the best number or email to reach you on?"
        }`
      );
    }

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system:
        voiceSystemPrompt(data) +
        "\n\nOutput ONLY the reply text — no quotes, no explanations.",
      messages: [
        {
          role: "user",
          content:
            `Conversation (oldest first):\n${transcript(
              data.messages,
              data.conversation.contactName,
            )}\n\nWrite our next reply.`,
        },
      ],
    });
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("No suggestion generated");
    return text.text.trim();
  },
});
