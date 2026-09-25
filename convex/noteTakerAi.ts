"use node";

import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { z } from "zod";
import { sendEmail } from "./lib/email";
import { formatDuration, type MeetingNotes } from "../lib/note-taker";

/**
 * AI Note Taker — the writing half. One structured Claude pass turns a
 * transcript into notes (summary, decisions, action items, chapters, a
 * follow-up draft, coaching), then the recap email goes out. "Ask this
 * meeting" answers questions from the transcript, citing timestamps.
 */

const MODEL = "claude-opus-5";

const notesSchema = z.object({
  // 4–8 words, specific: "Q4 pricing review with Acme".
  title: z.string(),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  decisions: z.array(z.string()),
  actionItems: z.array(
    z.object({
      task: z.string(),
      owner: z.string().nullable(),
      due: z.string().nullable(),
    }),
  ),
  openQuestions: z.array(z.string()),
  chapters: z.array(
    z.object({
      title: z.string(),
      // Seconds from the start, taken from the [h:mm:ss] marks.
      startSec: z.number(),
      summary: z.string(),
    }),
  ),
  followUpEmail: z.object({ subject: z.string(), body: z.string() }),
  coaching: z.object({
    sentiment: z.enum(["positive", "neutral", "mixed", "negative"]),
    highlights: z.array(z.string()),
    suggestions: z.array(z.string()),
  }),
});

/**
 * What to tell the user when a Claude call fails. Billing and capacity
 * problems get a plain, actionable line; the provider's own wording (which
 * names Anthropic) never reaches a white-labelled client.
 */
function aiFailureMessage(error: unknown, fallback: string): string {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : "";
  if (/credit balance|billing/i.test(message)) {
    return "AI notes are paused — the platform's AI account is out of credits. Once an admin tops it up, press “Write the notes again”.";
  }
  if (status === 429 || /rate.?limit/i.test(message)) {
    return "The AI is busy right now — try again in a minute.";
  }
  if (status === 529 || /overloaded/i.test(message)) {
    return "The AI service is overloaded at the moment — try again shortly.";
  }
  if (status === 401 || status === 403) {
    return "The platform's AI key was rejected — an admin needs to check it.";
  }
  return fallback;
}

const NOTES_SYSTEM =
  "You write meeting notes from a speaker-labelled transcript. Lines look " +
  "like '[12:04] Dana: …' — the bracket is time from the start. Write for " +
  "someone who missed the meeting and has two minutes.\n" +
  "- title: 4–8 specific words (topic + who), no 'Meeting about'.\n" +
  "- summary: 3–5 sentences — what it was for, what happened, where it landed.\n" +
  "- keyPoints: the substance, one fact or argument each, most important first.\n" +
  "- decisions: only things actually agreed. Empty if none.\n" +
  "- actionItems: concrete tasks; owner = the person who took it (exact " +
  "speaker name) or null if nobody did; due = the stated deadline in the " +
  "speakers' own words, else null. Never assign owners or dates yourself.\n" +
  "- openQuestions: raised but left unresolved.\n" +
  "- chapters: 3–8 topic sections in order; startSec converted from the " +
  "bracket where that topic begins.\n" +
  "- followUpEmail: a ready-to-send recap from the host to the attendees — " +
  "warm, brief, plain text, restating decisions and who owes what. No " +
  "placeholders like [Name].\n" +
  "- coaching: for the host — overall sentiment; highlights = what went " +
  "well; suggestions = specific, kind, actionable (talk balance, unanswered " +
  "questions, missed next steps).\n" +
  "Use only what was said. Never invent names, numbers, dates or commitments.";

/** Transcript → notes → recap email. Runs once per meeting, off the scheduler. */
export const generateNotes = internalAction({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<void> => {
    const data = await ctx.runQuery(internal.noteTaker.getNotesContext, {
      meetingId: args.meetingId,
    });
    if (!data) return;
    const fail = async (failure: string) =>
      await ctx.runMutation(internal.noteTaker.storeNotes, {
        meetingId: args.meetingId,
        failure,
      });
    if (!data.transcript.trim()) {
      await fail("No speech was detected in this meeting.");
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      await fail("AI notes aren't switched on yet (ANTHROPIC_API_KEY).");
      return;
    }
    const { meeting } = data;
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
      const client = new Anthropic();
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system: NOTES_SYSTEM,
        messages: [
          {
            role: "user",
            content:
              `Host: ${data.hostName ?? "the account owner"}\n` +
              `Meeting (working title): ${meeting.title}\n` +
              `Date: ${new Date(meeting.startedAt ?? meeting._creationTime).toUTCString()}\n` +
              `Length: ${formatDuration(meeting.durationSec ?? 0)}\n` +
              `People: ${(meeting.attendees ?? []).map((a) => a.name).join(", ") || "unknown"}\n\n` +
              `Transcript:\n${data.transcript}`,
          },
        ],
        output_config: { format: zodOutputFormat(notesSchema) },
      });
      if (response.stop_reason === "refusal" || !response.parsed_output) {
        await fail("The AI couldn't write notes for this meeting.");
        return;
      }
      const notes: MeetingNotes = response.parsed_output;
      await ctx.runMutation(internal.noteTaker.storeNotes, {
        meetingId: args.meetingId,
        notes,
      });
      // A re-run of the notes must not email everyone a second time.
      if (!meeting.recapSentAt) await deliverRecap(ctx, args.meetingId, null);
    } catch (error) {
      console.error("Note taker: notes pass failed", error);
      await fail(
        aiFailureMessage(
          error,
          "Writing the notes failed — the transcript is still available.",
        ),
      );
    }
  },
});

/** "Write the notes again" — after a failed pass, or for a fresh take. */
export const regenerateNotes = action({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<void> => {
    const meeting = await ctx.runQuery(internal.noteTaker.getOwnMeeting, {
      meetingId: args.meetingId,
    });
    if (!meeting) throw new Error("Meeting not found");
    if (!meeting.finalizedAt) throw new Error("The transcript isn't in yet");
    if (meeting.notesStatus === "pending") return;
    await ctx.runMutation(internal.noteTaker.patchMeeting, {
      meetingId: args.meetingId,
      status: "processing",
      notesStatus: "pending",
      clearStatusDetail: true,
    });
    await ctx.scheduler.runAfter(0, internal.noteTakerAi.generateNotes, {
      meetingId: args.meetingId,
    });
  },
});

// ── Recap email ─────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function recapHtml(args: {
  title: string;
  when: string;
  length: string;
  people: string;
  notes: MeetingNotes;
  link: string | null;
}): string {
  const { notes } = args;
  const section = (heading: string, items: string[]) =>
    items.length === 0
      ? ""
      : `<h3 style="margin:24px 0 8px;font-size:15px">${heading}</h3><ul style="margin:0;padding-left:20px">${items
          .map((item) => `<li style="margin:4px 0">${item}</li>`)
          .join("")}</ul>`;
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;color:#111;line-height:1.55">` +
    `<h2 style="margin:0 0 4px;font-size:20px">${escapeHtml(args.title)}</h2>` +
    `<p style="margin:0 0 16px;color:#666;font-size:13px">${escapeHtml(
      [args.when, args.length, args.people].filter(Boolean).join(" · "),
    )}</p>` +
    `<p style="margin:0">${escapeHtml(notes.summary)}</p>` +
    section("Key points", notes.keyPoints.map(escapeHtml)) +
    section("Decisions", notes.decisions.map(escapeHtml)) +
    section(
      "Action items",
      notes.actionItems.map(
        (a) =>
          `${escapeHtml(a.task)}${a.owner ? ` — <strong>${escapeHtml(a.owner)}</strong>` : ""}${
            a.due ? ` <span style="color:#666">(${escapeHtml(a.due)})</span>` : ""
          }`,
      ),
    ) +
    section("Open questions", notes.openQuestions.map(escapeHtml)) +
    (args.link
      ? `<p style="margin:28px 0 0"><a href="${args.link}" style="color:#111;font-weight:600">Open the full notes, transcript and recording →</a></p>`
      : "") +
    `<p style="margin:28px 0 0;color:#999;font-size:12px">Written by your AI Note Taker.</p>` +
    `</div>`
  );
}

/**
 * Send the recap. `onlyTo` = the "Email me this" button (one recipient);
 * null = the automatic send, addressed per the workspace's recap settings.
 */
async function deliverRecap(
  ctx: ActionCtx,
  meetingId: Id<"meetings">,
  onlyTo: string | null,
): Promise<{ sent: boolean; reason?: string }> {
  const data = await ctx.runQuery(internal.noteTaker.getNotesContext, { meetingId });
  if (!data?.meeting.notes) return { sent: false, reason: "No notes yet" };
  const { meeting, settings } = data;
  const recipients = new Set<string>();
  if (onlyTo) {
    recipients.add(onlyTo);
  } else {
    if (settings.recapAudience !== "none" && data.hostEmail) {
      recipients.add(data.hostEmail);
    }
    if (settings.recapAudience === "attendees") {
      for (const person of meeting.attendees ?? []) {
        if (person.email) recipients.add(person.email.toLowerCase());
      }
    }
    for (const extra of settings.recapExtraEmails) recipients.add(extra);
  }
  if (recipients.size === 0) return { sent: false, reason: "Nobody to send to" };
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  const result = await sendEmail({
    to: [...recipients],
    subject: `Meeting notes: ${meeting.title}`,
    html: recapHtml({
      title: meeting.title,
      when: new Date(meeting.startedAt ?? meeting._creationTime).toUTCString(),
      length: meeting.durationSec ? formatDuration(meeting.durationSec) : "",
      people: (meeting.attendees ?? []).map((a) => a.name).join(", "),
      notes: meeting.notes as MeetingNotes,
      link: appUrl ? `${appUrl}/note-taker` : null,
    }),
  });
  if (result.sent && !onlyTo) {
    await ctx.runMutation(internal.noteTaker.patchMeeting, {
      meetingId,
      recapSentAt: Date.now(),
    });
  }
  return result;
}

/** "Email me the recap" on a finished meeting. */
export const emailRecap = action({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<{ sentTo: string }> => {
    const own = await ctx.runQuery(internal.noteTaker.getRecapContext, {
      meetingId: args.meetingId,
    });
    if (!own) throw new Error("Meeting not found");
    const result = await deliverRecap(ctx, args.meetingId, own.callerEmail);
    if (!result.sent) {
      throw new Error(
        result.reason === "RESEND_API_KEY not configured"
          ? "NOT_CONFIGURED: Email isn't switched on yet (RESEND_API_KEY)."
          : (result.reason ?? "Couldn't send the email"),
      );
    }
    return { sentTo: own.callerEmail };
  },
});

// ── Ask this meeting ────────────────────────────────────────────────────

const ASK_SYSTEM =
  "You answer questions about one meeting, using ONLY its transcript " +
  "(below). Lines look like '[12:04] Dana: …'. Be direct and brief; quote " +
  "or paraphrase what was said and cite the moment as [12:04] so the reader " +
  "can jump there. If the transcript doesn't contain the answer, say so " +
  "plainly — never guess or bring in outside facts. Plain text, short " +
  "paragraphs or a few bullets.";

export const askMeeting = action({
  args: { meetingId: v.id("meetings"), question: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const question = args.question.trim().slice(0, 2000);
    if (!question) throw new Error("Ask a question first");
    const data = await ctx.runQuery(internal.noteTaker.getAskContext, {
      meetingId: args.meetingId,
    });
    if (!data) throw new Error("Meeting not found");
    if (!data.transcript.trim()) {
      throw new Error("This meeting has no transcript to ask about");
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("NOT_CONFIGURED: Ask AI needs ANTHROPIC_API_KEY.");
    }
    const save = async (role: "user" | "assistant", content: string) =>
      await ctx.runMutation(internal.noteTaker.insertChat, {
        meetingId: args.meetingId,
        workspaceId: data.workspaceId,
        userId: data.userId,
        role,
        content,
      });
    await save("user", question);

    // The API wants the thread to open on a user turn.
    const history = [...data.history];
    while (history.length > 0 && history[0].role !== "user") history.shift();

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    let response: Awaited<ReturnType<typeof client.messages.create>>;
    try {
      response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // The transcript is the stable prefix — cached, so follow-up questions
      // on the same meeting only pay for the new turn.
      system: [
        { type: "text", text: ASK_SYSTEM },
        {
          type: "text",
          text: `Meeting: ${data.title}\n\nTranscript:\n${data.transcript}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [...history, { role: "user" as const, content: question }],
      });
    } catch (error) {
      console.error("Note taker: ask failed", error);
      throw new Error(aiFailureMessage(error, "Couldn't get an answer right now."));
    }
    if (!("content" in response)) throw new Error("Couldn't get an answer right now.");
    const answer = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    if (response.stop_reason === "refusal" || !answer) {
      const fallback = "I couldn't answer that from this meeting's transcript.";
      await save("assistant", fallback);
      return fallback;
    }
    await save("assistant", answer);
    return answer;
  },
});
