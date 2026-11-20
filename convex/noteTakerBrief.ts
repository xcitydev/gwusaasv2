"use node";

import { internalAction, type ActionCtx } from "./_generated/server";
import { action } from "./lib/functions";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { z } from "zod";
import { sendEmail } from "./lib/email";
import { OUTPUT_LANGUAGES, type MeetingBrief } from "../lib/note-taker";

/**
 * Pre-meeting brief: before a scheduled meeting, one Sonnet pass turns what
 * we already know (lead record, outreach + replies, past meetings and their
 * open action items, Instagram DMs) into a one-page prep, saved on the
 * meeting and emailed to the host.
 */

const BRIEF_MODEL = "claude-sonnet-5-5";

const briefSchema = z.object({
  headline: z.string(),
  people: z.array(
    z.object({
      name: z.string(),
      who: z.string(),
      history: z.string(),
      openItems: z.array(z.string()),
    }),
  ),
  openPromises: z.array(z.string()),
  suggestedAgenda: z.array(z.string()),
  questionsToAsk: z.array(z.string()),
  watchOuts: z.array(z.string()),
});

const BRIEF_SYSTEM =
  "You prepare the host for an upcoming meeting in two minutes of reading. " +
  "You get the meeting and, for each guest, what the host's own records " +
  "hold: their lead record, outreach campaigns and email replies, past " +
  "meetings with their summaries and action items, and Instagram DM threads " +
  "matched ONLY by name (treat those as 'possibly the same person' and say so).\n" +
  "- headline: one sentence — who this is with and where things stand.\n" +
  "- people: per guest — who: role/company in a few words ('unknown' if we " +
  "have nothing); history: our relationship so far in 1–2 sentences, oldest " +
  "to newest; openItems: things still open with them.\n" +
  "- openPromises: what WE promised them (or they promised us) that isn't " +
  "done, from past action items and replies, with owner.\n" +
  "- suggestedAgenda: 3–5 items, in order.\n" +
  "- questionsToAsk: 3–5 specific questions that move it forward.\n" +
  "- watchOuts: objections, complaints or risks raised before. Empty if none.\n" +
  "Use only the records given. If there's no history at all, say it's a " +
  "first conversation and keep the rest short. Never invent facts, numbers " +
  "or commitments.";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function briefHtml(title: string, when: string, brief: MeetingBrief, link: string | null): string {
  const list = (heading: string, items: string[] | undefined) =>
    !items || items.length === 0
      ? ""
      : `<h3 style="margin:22px 0 6px;font-size:15px">${heading}</h3><ul style="margin:0;padding-left:20px">${items
          .map((i) => `<li style="margin:4px 0">${escapeHtml(i)}</li>`)
          .join("")}</ul>`;
  const people = (brief.people ?? [])
    .map(
      (p) =>
        `<p style="margin:10px 0 0"><strong>${escapeHtml(p.name)}</strong> — ${escapeHtml(p.who)}<br>` +
        `<span style="color:#444">${escapeHtml(p.history)}</span></p>`,
    )
    .join("");
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;color:#111;line-height:1.55">` +
    `<p style="margin:0;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Prep · ${escapeHtml(when)}</p>` +
    `<h2 style="margin:4px 0 8px;font-size:20px">${escapeHtml(title)}</h2>` +
    `<p style="margin:0">${escapeHtml(brief.headline ?? "")}</p>` +
    (people ? `<h3 style="margin:22px 0 2px;font-size:15px">Who's coming</h3>${people}` : "") +
    list("Open promises", brief.openPromises) +
    list("Suggested agenda", brief.suggestedAgenda) +
    list("Questions to ask", brief.questionsToAsk) +
    list("Watch out for", brief.watchOuts) +
    (link
      ? `<p style="margin:26px 0 0"><a href="${link}" style="color:#111;font-weight:600">Open the meeting →</a></p>`
      : "") +
    `<p style="margin:26px 0 0;color:#999;font-size:12px">Prepared by your AI Note Taker from your own leads, outreach and past meetings.</p>` +
    `</div>`
  );
}

async function writeBrief(
  ctx: ActionCtx,
  meetingId: Id<"meetings">,
  opts: { email: boolean },
): Promise<MeetingBrief> {
  const data = await ctx.runQuery(internal.noteTakerBriefData.briefContext, { meetingId });
  if (!data) throw new Error("Meeting not found");
  const save = async (brief: MeetingBrief) => {
    await ctx.runMutation(internal.noteTaker.patchMeeting, { meetingId, brief });
    return brief;
  };
  if (!process.env.ANTHROPIC_API_KEY) {
    return await save({
      status: "failed",
      generatedAt: Date.now(),
      reason: "Briefs aren't switched on for the platform yet.",
    });
  }
  const paid = await ctx.runMutation(internal.noteTakerBriefData.chargeBrief, { meetingId });
  if (!paid) {
    return await save({
      status: "skipped",
      generatedAt: Date.now(),
      reason: "Not enough credits for a brief — top up to get them again.",
    });
  }

  const sources = {
    leads: data.people.filter((p) => p.lead).length,
    replies: data.people.reduce((sum, p) => sum + p.replies.length, 0),
    meetings: data.people.reduce((sum, p) => sum + p.pastMeetings.length, 0),
    dms: data.people.reduce((sum, p) => sum + p.dmMatches.length, 0),
  };
  const language =
    data.outputLanguage !== "auto" && OUTPUT_LANGUAGES[data.outputLanguage]
      ? `\nWrite everything in ${OUTPUT_LANGUAGES[data.outputLanguage]}.`
      : "";
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: BRIEF_MODEL,
      max_tokens: 4000,
      system: BRIEF_SYSTEM + language,
      messages: [
        {
          role: "user",
          content:
            `Host: ${data.hostName ?? "the account owner"}\n` +
            `Meeting: ${data.meeting.title}\n` +
            `Starts: ${data.meeting.scheduledFor ? new Date(data.meeting.scheduledFor).toUTCString() : "soon"}\n` +
            (data.meeting.agenda.length
              ? `Planned agenda: ${data.meeting.agenda.map((a) => `${a.title} (${a.minutes} min)`).join("; ")}\n`
              : "") +
            `\nGuests and what we know (JSON):\n${JSON.stringify(data.people, null, 1)}`,
        },
      ],
      output_config: { format: zodOutputFormat(briefSchema) },
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return await save({
        status: "failed",
        generatedAt: Date.now(),
        reason: "The brief couldn't be written for this meeting.",
      });
    }
    const brief = await save({
      status: "ready",
      generatedAt: Date.now(),
      sources,
      ...response.parsed_output,
    });
    if (opts.email && data.hostEmail) {
      const appUrl = process.env.APP_URL?.replace(/\/$/, "");
      await sendEmail({
        to: [data.hostEmail],
        subject: `Prep: ${data.meeting.title}`,
        html: briefHtml(
          data.meeting.title,
          data.meeting.scheduledFor ? new Date(data.meeting.scheduledFor).toUTCString() : "",
          brief,
          appUrl ? `${appUrl}/note-taker?meeting=${meetingId}` : null,
        ),
      });
    }
    return brief;
  } catch (error) {
    console.error("Note taker: brief failed", error);
    const message = error instanceof Error ? error.message : "";
    return await save({
      status: "failed",
      generatedAt: Date.now(),
      reason: /credit balance|billing/i.test(message)
        ? "Briefs are paused — the platform's AI account is out of credits."
        : "Writing the brief failed — try “Prepare now” again.",
    });
  }
}

/**
 * Scheduled run (settings.briefLeadMin before the start). Only fires for a
 * meeting that's still scheduled at that same time — moved or cancelled
 * meetings are left alone (the reschedule queues its own run).
 */
export const scheduledBrief = internalAction({
  args: { meetingId: v.id("meetings"), forStart: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const meeting = await ctx.runQuery(internal.noteTaker.getMeetingInternal, {
      meetingId: args.meetingId,
    });
    if (
      !meeting ||
      meeting.status !== "scheduled" ||
      meeting.scheduledFor !== args.forStart ||
      meeting.briefScheduledFor !== args.forStart
    ) {
      return;
    }
    const existing = meeting.brief as MeetingBrief | undefined;
    if (existing?.status === "ready" && existing.generatedAt > args.forStart - 24 * 60 * 60_000) {
      return;
    }
    await writeBrief(ctx, args.meetingId, { email: true });
  },
});

/** "Prepare now" on a scheduled meeting (no email — it's on screen). */
export const prepareNow = action({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<MeetingBrief> => {
    const meeting = await ctx.runQuery(internal.noteTaker.getOwnMeeting, {
      meetingId: args.meetingId,
    });
    if (!meeting) throw new Error("Meeting not found");
    await ctx.runMutation(internal.rateLimits.hit, {
      key: `noteTakerBrief:${meeting.userId}`,
      limit: 20,
      windowMs: 60 * 60_000,
    });
    return await writeBrief(ctx, args.meetingId, { email: false });
  },
});
