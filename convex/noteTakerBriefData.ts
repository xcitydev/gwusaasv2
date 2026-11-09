import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getConfigValue } from "./config";
import { spendCredits } from "./lib/credits";
import type { MeetingNotes } from "../lib/note-taker";
import { emailDomain } from "../lib/note-taker";

/**
 * Pre-meeting brief — what we already know about the people on an
 * upcoming meeting, from this platform's own data: their lead record,
 * outreach campaigns and replies, past meetings (and what was promised),
 * and Instagram DM threads (matched by name — a "possible match").
 */

const MAX_PEOPLE = 8;

/** "𝐏𝐫𝐢𝐲𝐚 Nair, MD" → ["priya", "nair", "md"] (fancy Unicode letters folded). */
function nameTokens(name: string): string[] {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/** Every token of the guest's name appears in the DM contact's name. */
function sameName(wanted: string[], contactName: string | undefined): boolean {
  if (wanted.length === 0 || !contactName) return false;
  const have = new Set(nameTokens(contactName));
  // A single-word name ("Morgan") is too ambiguous to match on.
  if (wanted.length === 1) return false;
  return wanted.every((token) => have.has(token));
}

export const briefContext = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return null;
    const workspace = await ctx.db.get(meeting.workspaceId);
    if (!workspace) return null;
    const host = await ctx.db.get(meeting.userId);
    const settings = await ctx.db
      .query("noteTakerSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", meeting.workspaceId))
      .first();

    // Teammates aren't "who we're meeting".
    const members = await ctx.db
      .query("members")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", meeting.workspaceId))
      .take(200);
    const teamEmails = new Set<string>();
    for (const member of members) {
      const user = await ctx.db.get(member.userId);
      if (user?.email) teamEmails.add(user.email.toLowerCase());
    }
    const internalDomains = new Set(
      (settings?.internalDomains ?? []).map((d) => d.toLowerCase()),
    );

    const guests = (meeting.attendees ?? [])
      .filter((a) => {
        const email = a.email?.toLowerCase();
        if (!email) return true;
        return !teamEmails.has(email) && !internalDomains.has(emailDomain(email));
      })
      .slice(0, MAX_PEOPLE);

    const people = [];
    for (const guest of guests) {
      const email = guest.email?.trim().toLowerCase() ?? null;
      const lead = email
        ? ((await ctx.db
            .query("leads")
            .withIndex("by_workspace_email", (q) =>
              q.eq("workspaceId", meeting.workspaceId).eq("email", email),
            )
            .first()) ??
          (guest.email && guest.email !== email
            ? await ctx.db
                .query("leads")
                .withIndex("by_workspace_email", (q) =>
                  q.eq("workspaceId", meeting.workspaceId).eq("email", guest.email!),
                )
                .first()
            : null))
        : null;

      const campaigns = [];
      if (lead) {
        const links = await ctx.db
          .query("campaignLeads")
          .withIndex("by_lead", (q) => q.eq("leadId", lead._id))
          .take(5);
        for (const link of links) {
          const campaign = await ctx.db.get(link.campaignId);
          if (campaign) campaigns.push({ name: campaign.name, status: link.status });
        }
      }

      const replies = email
        ? (
            await ctx.db
              .query("replies")
              .withIndex("by_workspace_lead_email", (q) =>
                q.eq("workspaceId", meeting.workspaceId).eq("leadEmail", email),
              )
              .order("desc")
              .take(4)
          ).map((r) => ({
            at: r.receivedAt,
            direction: r.direction ?? "inbound",
            category: r.category,
            subject: r.subject,
            body: r.body.replace(/\s+/g, " ").slice(0, 500),
          }))
        : [];

      const pastMeetings = [];
      if (email) {
        const rows = await ctx.db
          .query("meetingAttendees")
          .withIndex("by_workspace_email", (q) =>
            q.eq("workspaceId", meeting.workspaceId).eq("email", email),
          )
          .order("desc")
          .take(8);
        for (const row of rows) {
          if (row.meetingId === meeting._id || pastMeetings.length >= 4) continue;
          const past = await ctx.db.get(row.meetingId);
          if (!past || past.status !== "done" || !past.notes) continue;
          const notes = past.notes as MeetingNotes;
          pastMeetings.push({
            title: past.title,
            at: past.startedAt ?? past._creationTime,
            summary: notes.summary.slice(0, 700),
            decisions: notes.decisions.slice(0, 5),
            actionItems: notes.actionItems.slice(0, 8),
            openQuestions: notes.openQuestions.slice(0, 4),
          });
        }
      }

      // Instagram DMs carry no email — a name match is only a maybe.
      const dmMatches = [];
      if (guest.name && guest.name.length >= 3 && guest.name !== guest.email) {
        const hits = await ctx.db
          .query("igConversations")
          .withSearchIndex("search_name", (q) =>
            q.search("contactName", guest.name).eq("workspaceId", meeting.workspaceId),
          )
          .take(10);
        // Search matches ANY word ("Priya Nair" → "Narayanan Nair"); keep only
        // threads whose name holds every part of the guest's name.
        const wanted = nameTokens(guest.name);
        for (const hit of hits.filter((h) => sameName(wanted, h.contactName)).slice(0, 2)) {
          dmMatches.push({
            contactName: hit.contactName ?? "",
            stage: hit.stage ?? null,
            lastPreview: hit.lastPreview?.slice(0, 300) ?? null,
            nextAction: hit.nextAction ?? null,
            lastMessageAt: hit.lastMessageAt,
          });
        }
      }

      people.push({
        name: guest.name,
        email,
        lead: lead
          ? {
              name: lead.name ?? null,
              company: lead.company ?? null,
              title: lead.title ?? null,
              industry: lead.industry ?? null,
              location: lead.location ?? null,
              website: lead.website ?? null,
              source: lead.source ?? null,
            }
          : null,
        campaigns,
        replies,
        pastMeetings,
        dmMatches,
      });
    }

    return {
      meeting: {
        _id: meeting._id,
        title: meeting.title,
        status: meeting.status,
        scheduledFor: meeting.scheduledFor ?? null,
        agenda: meeting.agenda ?? [],
        workspaceId: meeting.workspaceId,
        brief: meeting.brief ?? null,
      },
      hostName: host?.name ?? null,
      hostEmail: host?.email ?? null,
      outputLanguage: settings?.outputLanguage ?? "auto",
      briefEnabled: settings?.briefEnabled ?? true,
      people,
    };
  },
});

/** Bill one brief; false when the balance can't cover it (then skip it). */
export const chargeBrief = internalMutation({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<boolean> => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return false;
    const workspace = await ctx.db.get(meeting.workspaceId);
    const cost = await getConfigValue(ctx, "noteTakerBriefCredits");
    if (cost <= 0) return true;
    if (!workspace || workspace.credits < cost) return false;
    await spendCredits(ctx, {
      workspaceId: meeting.workspaceId,
      amount: cost,
      feature: "note_taker",
      description: "Pre-meeting brief",
      userId: meeting.userId,
      meta: { meetingId: args.meetingId },
    });
    return true;
  },
});
