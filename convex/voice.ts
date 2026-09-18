import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { spendCredits, grantCredits } from "./lib/credits";
import { getConfigValue } from "./config";
import { notify } from "./notifications";

async function currentWorkspace(ctx: Parameters<typeof getCurrentUser>[0]) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  return await getPrimaryWorkspace(ctx, user._id);
}

// ── Receptionist ────────────────────────────────────────────────────────

export const MAX_RECEPTIONISTS = 3;

export const listReceptionists = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return [];
    const receptionists = await ctx.db
      .query("receptionists")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return await Promise.all(
      receptionists.map(async (receptionist) => {
        const number = receptionist.phoneNumberId
          ? await ctx.db.get(receptionist.phoneNumberId)
          : null;
        // Never ship the encrypted Cal.com key to the client.
        const { calcomKeyEncrypted, ...safe } = receptionist;
        return {
          ...safe,
          phoneNumber: number?.number ?? null,
          hasCalcomKey: Boolean(calcomKeyEncrypted),
        };
      }),
    );
  },
});

/** Internal: booking settings incl. the encrypted key, for the auto-booker. */
export const getBookingSettings = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const callDoc = await ctx.db.get(args.callId);
    if (!callDoc?.receptionistId) return null;
    const receptionist = await ctx.db.get(callDoc.receptionistId);
    if (!receptionist) return null;
    return {
      call: callDoc,
      autoBook: receptionist.autoBook ?? false,
      calcomUsername: receptionist.calcomUsername ?? null,
      calcomEventSlug: receptionist.calcomEventSlug ?? null,
      calcomLink: receptionist.calcomLink ?? null,
      calcomKeyEncrypted: receptionist.calcomKeyEncrypted ?? null,
      calcomEventTypeId: receptionist.calcomEventTypeId ?? null,
      bookingTimezone: receptionist.bookingTimezone ?? "America/New_York",
      ownerId: (await ctx.db.get(callDoc.workspaceId))?.ownerId ?? null,
    };
  },
});

export const setBookingSettings = internalMutation({
  args: {
    receptionistId: v.id("receptionists"),
    autoBook: v.boolean(),
    calcomLink: v.optional(v.string()),
    calcomUsername: v.optional(v.string()),
    calcomEventSlug: v.optional(v.string()),
    bookingTimezone: v.string(),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceStrict(ctx);
    const receptionist = await ctx.db.get(args.receptionistId);
    if (!receptionist || receptionist.workspaceId !== workspace._id) {
      throw new Error("Receptionist not found");
    }
    await ctx.db.patch(receptionist._id, {
      autoBook: args.autoBook,
      bookingTimezone: args.bookingTimezone,
      calcomLink: args.calcomLink,
      calcomUsername: args.calcomUsername,
      calcomEventSlug: args.calcomEventSlug,
    });
  },
});

/** Merge the auto-booking outcome into the call's analysis + notify. */
export const setAutoBookingResult = internalMutation({
  args: {
    callId: v.id("calls"),
    autoBooking: v.any(),
    notifyUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callDoc = await ctx.db.get(args.callId);
    if (!callDoc) return;
    const result = { ...(callDoc.result ?? {}), autoBooking: args.autoBooking };
    await ctx.db.patch(args.callId, { result });
    const status = (args.autoBooking as { status?: string }).status;
    if (args.notifyUserId) {
      await notify(ctx, {
        userId: args.notifyUserId,
        workspaceId: callDoc.workspaceId,
        type: "auto_booking",
        title:
          status === "booked"
            ? "Appointment auto-scheduled on your calendar"
            : "A caller wanted to book — needs your attention",
        body: String((args.autoBooking as { detail?: string }).detail ?? ""),
        href: "/receptionist",
      });
    }
  },
});

export const saveReceptionist = mutation({
  args: {
    id: v.optional(v.id("receptionists")),
    name: v.string(),
    prompt: v.string(),
    voice: v.string(),
    backgroundTrack: v.optional(v.string()),
    greeting: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    if (!args.name.trim() || !args.prompt.trim()) {
      throw new Error("Name and prompt are required");
    }
    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing || existing.workspaceId !== workspace._id) {
        throw new Error("Receptionist not found");
      }
      await ctx.db.patch(args.id, {
        name: args.name.trim(),
        prompt: args.prompt.trim(),
        voice: args.voice,
        backgroundTrack: args.backgroundTrack,
        greeting: args.greeting?.trim(),
      });
      return args.id;
    }
    const existing = await ctx.db
      .query("receptionists")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    if (existing.length >= MAX_RECEPTIONISTS) {
      throw new Error(
        `You've reached the limit of ${MAX_RECEPTIONISTS} receptionists — delete one to create another.`,
      );
    }
    return await ctx.db.insert("receptionists", {
      workspaceId: workspace._id,
      name: args.name.trim(),
      prompt: args.prompt.trim(),
      voice: args.voice,
      backgroundTrack: args.backgroundTrack,
      greeting: args.greeting?.trim(),
      status: "draft",
    });
  },
});

export const deleteReceptionist = mutation({
  args: { id: v.id("receptionists") },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceStrict(ctx);
    const receptionist = await ctx.db.get(args.id);
    if (!receptionist || receptionist.workspaceId !== workspace._id) {
      throw new Error("Receptionist not found");
    }
    await ctx.db.delete(args.id);
  },
});

// ── Phone numbers ───────────────────────────────────────────────────────

export const listNumbers = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return [];
    return await ctx.db
      .query("phoneNumbers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
  },
});

export const recordClonedVoice = internalMutation({
  args: { voiceId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const { user, workspace } = await requireWorkspaceStrict(ctx);
    await ctx.db.insert("clonedVoices", {
      workspaceId: workspace._id,
      userId: user._id,
      voiceId: args.voiceId,
      name: args.name,
    });
  },
});

/** Bland voice ids of the clones this workspace owns. */
export const listWorkspaceCloneIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    const rows = await ctx.db
      .query("clonedVoices")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return rows.map((r) => r.voiceId);
  },
});

/** Remove a clone row if this workspace owns it; true when it existed. */
export const removeClonedVoice = internalMutation({
  args: { voiceId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const { workspace } = await requireWorkspaceStrict(ctx);
    const row = await ctx.db
      .query("clonedVoices")
      .withIndex("by_voice", (q) => q.eq("voiceId", args.voiceId))
      .first();
    if (!row || row.workspaceId !== workspace._id) return false;
    await ctx.db.delete(row._id);
    return true;
  },
});

/** Whether the calling user is a platform admin (any level). */
export const callerIsAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return Boolean(user?.adminRole);
  },
});

/** What a number costs the user, in credits (from admin config). */
export const numberPrice = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [priceUsd, creditPriceUsd] = await Promise.all([
      getConfigValue(ctx, "phoneNumberPriceUsd"),
      getConfigValue(ctx, "creditPriceUsd"),
    ]);
    const credits =
      creditPriceUsd > 0 ? Math.ceil(priceUsd / creditPriceUsd) : 0;
    return { priceUsd, credits };
  },
});

/** Charge the number's monthly price in credits before we buy it upstream. */
export const chargeForNumber = internalMutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const [priceUsd, creditPriceUsd] = await Promise.all([
      getConfigValue(ctx, "phoneNumberPriceUsd"),
      getConfigValue(ctx, "creditPriceUsd"),
    ]);
    const credits =
      creditPriceUsd > 0 ? Math.ceil(priceUsd / creditPriceUsd) : 0;
    if (credits > 0) {
      await spendCredits(ctx, {
        workspaceId: workspace._id,
        amount: credits,
        feature: "phone_number",
        description: "Dedicated phone number — monthly",
        userId: user._id,
      });
    }
    return { credits };
  },
});

export const refundNumberCharge = internalMutation({
  args: { credits: v.number() },
  handler: async (ctx, args) => {
    if (args.credits <= 0) return;
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return;
    await grantCredits(ctx, {
      workspaceId: workspace._id,
      amount: args.credits,
      feature: "phone_number",
      description: "Refund — number purchase failed",
    });
  },
});

export const recordNumber = internalMutation({
  args: { number: v.string(), monthlyCostUsd: v.number() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const numberId = await ctx.db.insert("phoneNumbers", {
      workspaceId: workspace._id,
      number: args.number,
      provider: "bland",
      monthlyCostUsd: args.monthlyCostUsd,
      status: "active",
    });
    await ctx.db.insert("purchases", {
      workspaceId: workspace._id,
      userId: user._id,
      kind: "phone_number",
      amountUsd: args.monthlyCostUsd,
      status: "paid",
      meta: { number: args.number },
    });
    return numberId;
  },
});

export const attachNumberToReceptionist = mutation({
  args: {
    receptionistId: v.id("receptionists"),
    phoneNumberId: v.id("phoneNumbers"),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceStrict(ctx);
    const receptionist = await ctx.db.get(args.receptionistId);
    if (!receptionist || receptionist.workspaceId !== workspace._id) {
      throw new Error("Receptionist not found");
    }
    const number = await ctx.db.get(args.phoneNumberId);
    if (!number || number.workspaceId !== workspace._id) throw new Error("Number not found");
    // A number answers with exactly one prompt — detach it elsewhere first.
    const siblings = await ctx.db
      .query("receptionists")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    for (const sibling of siblings) {
      if (sibling._id !== args.receptionistId && sibling.phoneNumberId === args.phoneNumberId) {
        await ctx.db.patch(sibling._id, { phoneNumberId: undefined, status: "draft" });
      }
    }
    await ctx.db.patch(args.receptionistId, {
      phoneNumberId: args.phoneNumberId,
      status: "live",
    });
  },
});

async function requireWorkspaceStrict(ctx: Parameters<typeof requireUser>[0]) {
  const user = await requireUser(ctx);
  const workspace = await getPrimaryWorkspace(ctx, user._id);
  if (!workspace) throw new Error("No workspace");
  return { user, workspace };
}

// ── Qualifier ───────────────────────────────────────────────────────────

export const listQualifierCampaigns = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return [];
    return await ctx.db
      .query("qualifierCampaigns")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .collect();
  },
});

export const createQualifierCampaign = mutation({
  args: {
    name: v.string(),
    prompt: v.string(),
    callerName: v.optional(v.string()),
    voice: v.optional(v.string()),
    backgroundTrack: v.optional(v.string()),
    leadIds: v.array(v.id("leads")),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceStrict(ctx);
    if (!args.name.trim() || !args.prompt.trim()) {
      throw new Error("Name and qualification prompt are required");
    }
    if (args.leadIds.length === 0) throw new Error("Select at least one lead");

    const campaignId = await ctx.db.insert("qualifierCampaigns", {
      workspaceId: workspace._id,
      name: args.name.trim(),
      prompt: args.prompt.trim(),
      callerName: args.callerName?.trim() || undefined,
      voice: args.voice,
      backgroundTrack: args.backgroundTrack,
      status: "draft",
      leadCount: args.leadIds.length,
    });
    for (const leadId of args.leadIds) {
      const lead = await ctx.db.get(leadId);
      if (!lead || lead.workspaceId !== workspace._id || !lead.phone) continue;
      await ctx.db.insert("calls", {
        workspaceId: workspace._id,
        kind: "qualifier",
        qualifierCampaignId: campaignId,
        leadId,
        durationSec: 0,
        costCredits: 0,
        status: "pending",
      });
    }
    return campaignId;
  },
});

/** Everything the dispatcher needs to place this campaign's calls. */
export const getQualifierDispatch = internalQuery({
  args: { campaignId: v.id("qualifierCampaigns") },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;
    const rows = await ctx.db
      .query("calls")
      .withIndex("by_qualifier_campaign", (q) =>
        q.eq("qualifierCampaignId", args.campaignId),
      )
      .collect();
    const pending: {
      callId: Id<"calls">;
      phone: string;
      name: string | null;
      company: string | null;
    }[] = [];
    for (const row of rows) {
      // "in_progress with no Bland id" = legacy stub rows from before
      // dispatch existed — treat them as never called.
      const undialed =
        row.status === "pending" ||
        (row.status === "in_progress" && !row.blandCallId);
      if (!undialed) continue;
      const lead = row.leadId ? await ctx.db.get(row.leadId) : null;
      if (!lead?.phone) continue;
      pending.push({
        callId: row._id,
        phone: lead.phone,
        name: lead.name ?? null,
        company: lead.company ?? null,
      });
    }
    return {
      prompt: campaign.prompt,
      callerName: campaign.callerName ?? null,
      voice: campaign.voice ?? null,
      backgroundTrack: campaign.backgroundTrack ?? null,
      status: campaign.status,
      pending,
    };
  },
});

export const setQualifierCampaignStatus = internalMutation({
  args: {
    id: v.id("qualifierCampaigns"),
    status: v.union(
      v.literal("draft"),
      v.literal("running"),
      v.literal("completed"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.status });
  },
});

export const markCallDispatched = internalMutation({
  args: { callId: v.id("calls"), blandCallId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.callId, {
      status: "in_progress",
      blandCallId: args.blandCallId,
    });
  },
});

export const getCallDispatchState = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const callDoc = await ctx.db.get(args.callId);
    if (!callDoc) return null;
    return { status: callDoc.status, blandCallId: callDoc.blandCallId ?? null };
  },
});

export const listCalls = query({
  args: { qualifierCampaignId: v.optional(v.id("qualifierCampaigns")) },
  handler: async (ctx, args) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return [];
    const calls = args.qualifierCampaignId
      ? await ctx.db
          .query("calls")
          .withIndex("by_qualifier_campaign", (q) =>
            q.eq("qualifierCampaignId", args.qualifierCampaignId!),
          )
          .order("desc")
          .take(200)
      : await ctx.db
          .query("calls")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
          .order("desc")
          .take(200);
    return await Promise.all(
      calls
        .filter((c) => c.workspaceId === workspace._id)
        .map(async (c) => {
          const lead = c.leadId ? await ctx.db.get(c.leadId) : null;
          return {
            ...c,
            leadName: lead?.name ?? lead?.email ?? null,
            leadPhone: lead?.phone ?? null,
          };
        }),
    );
  },
});

/** Webhook-driven: finalize a call's duration and bill credits per second. */
export const completeCall = internalMutation({
  args: {
    callId: v.id("calls"),
    durationSec: v.number(),
    transcript: v.optional(v.string()),
    result: v.optional(v.any()),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const callDoc = await ctx.db.get(args.callId);
    if (!callDoc) return;
    const perSecond = await getConfigValue(ctx, "voiceCreditsPerSecond");
    // Browser tests are never billed.
    const credits =
      args.failed || callDoc.isTest ? 0 : Math.ceil(args.durationSec * perSecond);
    if (credits > 0) {
      await spendCredits(ctx, {
        workspaceId: callDoc.workspaceId,
        amount: credits,
        feature: callDoc.kind === "receptionist" ? "receptionist" : "qualifier",
        description: `${callDoc.kind} call — ${args.durationSec}s`,
      });
    }
    await ctx.db.patch(args.callId, {
      status: args.failed ? "failed" : "completed",
      durationSec: args.durationSec,
      costCredits: credits,
      transcript: args.transcript,
      result: args.result,
    });
    // Extract booking details / outcome from the transcript with AI.
    if (!args.failed && args.transcript && args.transcript.trim()) {
      await ctx.scheduler.runAfter(0, internal.ai.analyzeCall, {
        callId: args.callId,
      });
    }
    // Last call in a qualifier campaign finishes the campaign (rehearsals
    // don't count — a test must never flip a draft to "completed").
    if (callDoc.qualifierCampaignId && !callDoc.isTest) {
      const siblings = await ctx.db
        .query("calls")
        .withIndex("by_qualifier_campaign", (q) =>
          q.eq("qualifierCampaignId", callDoc.qualifierCampaignId),
        )
        .collect();
      const unfinished = siblings.filter(
        (s) =>
          s._id !== args.callId &&
          (s.status === "pending" || s.status === "in_progress"),
      );
      if (unfinished.length === 0) {
        await ctx.db.patch(callDoc.qualifierCampaignId, {
          status: "completed",
        });
      }
    }
  },
});

/** Does this Bland call already have a local record? (webhook/sweep dedupe) */
export const findCallByBlandId = internalQuery({
  args: { blandCallId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("calls")
      .withIndex("by_bland_call", (q) => q.eq("blandCallId", args.blandCallId))
      .first();
    return existing ? existing._id : null;
  },
});

/**
 * Create the record for a REAL inbound call (a stranger dialing one of our
 * numbers). Unlike browser tests and qualifier calls, nothing pre-creates
 * these — the webhook/sweep calls this, then completeCall finishes the job
 * (billing, transcript, AI analysis → auto-booking).
 */
export const recordInboundCall = internalMutation({
  args: {
    blandCallId: v.string(),
    toNumber: v.string(),
    fromNumber: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"calls"> | null> => {
    const existing = await ctx.db
      .query("calls")
      .withIndex("by_bland_call", (q) => q.eq("blandCallId", args.blandCallId))
      .first();
    if (existing) return null;
    const numberRow = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_number", (q) => q.eq("number", args.toNumber))
      .first();
    if (!numberRow) return null;
    const receptionists = await ctx.db
      .query("receptionists")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", numberRow.workspaceId),
      )
      .collect();
    const receptionist = receptionists.find(
      (r) => r.phoneNumberId === numberRow._id,
    );
    return await ctx.db.insert("calls", {
      workspaceId: numberRow.workspaceId,
      kind: "receptionist",
      receptionistId: receptionist?._id,
      fromNumber: args.fromNumber,
      durationSec: 0,
      costCredits: 0,
      status: "in_progress",
      blandCallId: args.blandCallId,
    });
  },
});

// ── Call records + AI analysis ──────────────────────────────────────────

/** Record a qualifier browser rehearsal the moment it starts. */
export const createQualifierBrowserCall = internalMutation({
  args: {
    blandCallId: v.string(),
    campaignId: v.id("qualifierCampaigns"),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceStrict(ctx);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.workspaceId !== workspace._id) {
      throw new Error("Campaign not found");
    }
    return await ctx.db.insert("calls", {
      workspaceId: workspace._id,
      kind: "qualifier",
      qualifierCampaignId: args.campaignId,
      durationSec: 0,
      costCredits: 0,
      status: "in_progress",
      blandCallId: args.blandCallId,
      isTest: true,
    });
  },
});

/** Record a browser test session the moment it starts. */
export const createBrowserCall = internalMutation({
  args: { blandCallId: v.string(), receptionistId: v.id("receptionists") },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceStrict(ctx);
    const receptionist = await ctx.db.get(args.receptionistId);
    if (!receptionist || receptionist.workspaceId !== workspace._id) {
      throw new Error("Receptionist not found");
    }
    return await ctx.db.insert("calls", {
      workspaceId: workspace._id,
      kind: "receptionist",
      receptionistId: args.receptionistId,
      durationSec: 0,
      costCredits: 0,
      status: "in_progress",
      blandCallId: args.blandCallId,
      isTest: true,
    });
  },
});

/**
 * Re-fire the calendar booking for an analyzed call — e.g. after fixing
 * Cal.com availability — without doing another call.
 */
export const retryAutoBook = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspace?._id) {
      throw new Error("Call not found");
    }
    const result = (call.result ?? {}) as Record<string, unknown>;
    if (!result.bookingMade) {
      throw new Error("This call has no booking to schedule");
    }
    await ctx.db.patch(args.callId, {
      result: {
        ...result,
        autoBooking: { status: "pending", detail: "Booking on your calendar…" },
      },
    });
    await ctx.scheduler.runAfter(0, internal.voiceActions.autoBookFromCall, {
      callId: args.callId,
    });
  },
});

/** Maintenance: remove a dead call record (e.g. pre-feature artifacts). */
export const deleteCallInternal = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.callId);
  },
});

export const getCallForAnalysis = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const callDoc = await ctx.db.get(args.callId);
    if (!callDoc) return null;
    const receptionist = callDoc.receptionistId
      ? await ctx.db.get(callDoc.receptionistId)
      : null;
    return {
      ...callDoc,
      bookingTimezone: receptionist?.bookingTimezone ?? "America/New_York",
    };
  },
});

export const setCallAnalysis = internalMutation({
  args: { callId: v.id("calls"), analysis: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.callId, { result: args.analysis });
  },
});

/** One receptionist's call history, newest first — browser tests included. */
export const listReceptionistCalls = query({
  args: { receptionistId: v.id("receptionists") },
  handler: async (ctx, args) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return [];
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(200);
    return calls
      .filter((c) => c.kind === "receptionist" && c.receptionistId === args.receptionistId)
      .slice(0, 25);
  },
});
