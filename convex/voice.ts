import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Id, Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { spendCredits, grantCredits } from "./lib/credits";
import { assertPlanDb } from "./lib/plan";
import { getConfigValue } from "./config";
import { notify } from "./notifications";
import { toE164 } from "./lib/bland";

async function currentWorkspace(ctx: Parameters<typeof getCurrentUser>[0]) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  return await getPrimaryWorkspace(ctx, user._id);
}

/** Call engine: Bland (default) or ElevenLabs Agents ("Studio HD"). */
const engineArg = v.optional(v.union(v.literal("bland"), v.literal("elevenlabs")));

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
    engine: engineArg,
  },
  handler: async (ctx, args) => {
    await assertPlanDb(ctx, "personal", "AI Receptionist");
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
        ...(args.engine && { engine: args.engine }),
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
      engine: args.engine,
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
    // A Studio HD receptionist's agent goes too (its number stops answering).
    if (receptionist.elevenAgentId) {
      await ctx.scheduler.runAfter(0, internal.voiceActions.deleteElevenAgentInternal, {
        agentId: receptionist.elevenAgentId,
      });
    }
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
  args: {
    voiceId: v.string(),
    name: v.string(),
    provider: v.optional(v.union(v.literal("bland"), v.literal("elevenlabs"))),
    consentAttestedAt: v.number(),
    // Pooled clones: the kept recording (see voicePool.ts).
    sampleStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const { user, workspace } = await requireWorkspaceStrict(ctx);
    await ctx.db.insert("clonedVoices", {
      workspaceId: workspace._id,
      userId: user._id,
      voiceId: args.voiceId,
      name: args.name,
      provider: args.provider,
      consentAttestedAt: args.consentAttestedAt,
      sampleStorageId: args.sampleStorageId,
      lastUsedAt: args.sampleStorageId ? Date.now() : undefined,
    });
  },
});

/** Which clone engines are switched on — drives the engine toggle. */
export const cloneProviders = query({
  args: {},
  handler: async () => ({
    bland: Boolean(process.env.BLAND_API_KEY),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
  }),
});

/** This workspace's clones with their engine (Bland when unset). */
export const listWorkspaceClones = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ voiceId: string; name: string; provider: "bland" | "elevenlabs" }[]> => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    const rows = await ctx.db
      .query("clonedVoices")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    return rows.map((r) => ({
      voiceId: r.voiceId,
      name: r.name,
      provider: r.provider ?? "bland",
    }));
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
  args: { engine: engineArg },
  handler: async (ctx, args) => {
    const [priceUsd, creditPriceUsd] = await Promise.all([
      getConfigValue(
        ctx,
        args.engine === "elevenlabs" ? "studioNumberPriceUsd" : "phoneNumberPriceUsd",
      ),
      getConfigValue(ctx, "creditPriceUsd"),
    ]);
    const credits =
      creditPriceUsd > 0 ? Math.ceil(priceUsd / creditPriceUsd) : 0;
    return { priceUsd, credits };
  },
});

/** Charge the number's monthly price in credits before we buy it upstream. */
export const chargeForNumber = internalMutation({
  args: { engine: engineArg },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const [priceUsd, creditPriceUsd] = await Promise.all([
      getConfigValue(
        ctx,
        args.engine === "elevenlabs" ? "studioNumberPriceUsd" : "phoneNumberPriceUsd",
      ),
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
  args: {
    number: v.string(),
    monthlyCostUsd: v.number(),
    /** Studio HD numbers: bought on Twilio, imported into ElevenLabs. */
    twilioSid: v.optional(v.string()),
    elevenPhoneNumberId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const numberId = await ctx.db.insert("phoneNumbers", {
      workspaceId: workspace._id,
      number: args.number,
      provider: args.twilioSid ? "twilio" : "bland",
      monthlyCostUsd: args.monthlyCostUsd,
      status: "active",
      twilioSid: args.twilioSid,
      elevenPhoneNumberId: args.elevenPhoneNumberId,
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
    const numberEngine = number.provider === "twilio" ? "elevenlabs" : "bland";
    if ((receptionist.engine ?? "bland") !== numberEngine) {
      throw new Error(
        numberEngine === "elevenlabs"
          ? "That's a Studio HD number — switch this receptionist to Studio HD calling first."
          : "That's a Standard number — switch this receptionist to Standard calling or buy a Studio HD number.",
      );
    }
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

/**
 * What syncReceptionist pushes to the line — read from the DB, never from
 * the client, and only when the receptionist AND its number are the caller's.
 */
export const getReceptionistSync = internalQuery({
  args: { receptionistId: v.id("receptionists") },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceStrict(ctx);
    const receptionist = await ctx.db.get(args.receptionistId);
    if (!receptionist || receptionist.workspaceId !== workspace._id) {
      throw new Error("Receptionist not found");
    }
    return await receptionistSyncConfig(ctx, receptionist, workspace);
  },
});

/** Same, for the system (voice pool re-sync after a reload) — no caller. */
export const getReceptionistSyncById = internalQuery({
  args: { receptionistId: v.id("receptionists") },
  handler: async (ctx, args) => {
    const receptionist = await ctx.db.get(args.receptionistId);
    if (!receptionist || receptionist.status !== "live") return null;
    const workspace = await ctx.db.get(receptionist.workspaceId);
    if (!workspace) return null;
    try {
      return await receptionistSyncConfig(ctx, receptionist, workspace);
    } catch {
      return null; // number gone / detached — nothing to re-push
    }
  },
});

async function receptionistSyncConfig(
  ctx: QueryCtx,
  receptionist: Doc<"receptionists">,
  workspace: Doc<"workspaces">,
) {
  if (!receptionist.phoneNumberId) {
    throw new Error("Connect a phone number to this receptionist first");
  }
  const number = await ctx.db.get(receptionist.phoneNumberId);
  if (!number || number.workspaceId !== workspace._id || number.status !== "active") {
    throw new Error("Number not found");
  }
  const engine = receptionist.engine ?? "bland";
  const numberEngine = number.provider === "twilio" ? "elevenlabs" : "bland";
  if (engine !== numberEngine) {
    throw new Error(
      engine === "elevenlabs"
        ? "This number was bought for Standard calling — buy a Studio HD number for this receptionist."
        : "This number was bought for Studio HD calling — switch the receptionist to Studio HD or buy a Standard number.",
    );
  }
  return {
    receptionistId: receptionist._id,
    workspaceId: workspace._id,
    name: receptionist.name,
    engine,
    elevenAgentId: receptionist.elevenAgentId ?? undefined,
    elevenPhoneNumberId: number.elevenPhoneNumberId ?? undefined,
    phoneNumber: number.number,
    prompt: receptionist.prompt,
    voice: receptionist.voice,
    backgroundTrack: receptionist.backgroundTrack ?? undefined,
    greeting: receptionist.greeting ?? undefined,
    businessName: workspace.name,
  };
}

/** Remember the ElevenLabs agent synced from a receptionist. */
export const setReceptionistAgent = internalMutation({
  args: { receptionistId: v.id("receptionists"), elevenAgentId: v.string() },
  handler: async (ctx, args) => {
    const receptionist = await ctx.db.get(args.receptionistId);
    if (receptionist) await ctx.db.patch(args.receptionistId, { elevenAgentId: args.elevenAgentId });
  },
});

/** A browser-test call record, only if it's the caller's own test. */
export const getOwnedTestCall = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceStrict(ctx);
    const callDoc = await ctx.db.get(args.callId);
    if (!callDoc || callDoc.workspaceId !== workspace._id || !callDoc.isTest) {
      return null;
    }
    return {
      status: callDoc.status,
      blandCallId: callDoc.blandCallId ?? null,
      engine: callDoc.engine ?? "bland",
      elevenAgentId: callDoc.elevenAgentId ?? null,
      startedAt: callDoc._creationTime,
    };
  },
});

/** The caller's workspace name (greetings say who's answering). */
export const getCallerWorkspaceName = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { workspace } = await requireWorkspaceStrict(ctx);
    return { name: workspace.name };
  },
});

/** The caller's workspace — actions use it to scope internal calls. */
export const getCallerWorkspace = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { user, workspace } = await requireWorkspaceStrict(ctx);
    return { userId: user._id, workspaceId: workspace._id };
  },
});

// ── Calling compliance: do-not-call list + opt-out detection ───────────

/**
 * Caller-side phrases that mean "stop". Any refusal ends the call and puts
 * the number on the workspace's do-not-call list — we never re-dial a no.
 */
const OPT_OUT_PATTERN =
  /\b(stop calling|don'?t (ever )?call|do not call|remove me|take me off|unsubscribe|not interested|no thanks|no,? thank you|leave me alone|lose my number|never call)\b|^\s*stop\b/i;

/** The lead's own lines of a Bland transcript ("user:" / "caller:" / "human:"). */
function callerLines(transcript: string): string[] {
  const lines: string[] = [];
  for (const line of transcript.split(/\n+/)) {
    const match = line.match(/^\s*(user|caller|human)\s*:\s*(.*)$/i);
    if (match?.[2]?.trim()) lines.push(match[2].trim());
  }
  return lines;
}

function transcriptHasOptOut(transcript: string | undefined): boolean {
  if (!transcript) return false;
  return callerLines(transcript).some((line) => OPT_OUT_PATTERN.test(line));
}

async function isOptedOut(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  rawPhone: string | undefined,
): Promise<boolean> {
  const phone = rawPhone ? toE164(rawPhone) : null;
  if (!phone) return false;
  const row = await ctx.db
    .query("voiceOptOuts")
    .withIndex("by_workspace_phone", (q) =>
      q.eq("workspaceId", workspaceId).eq("phone", phone),
    )
    .first();
  return row !== null;
}

async function addOptOut(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    rawPhone: string | undefined;
    reason: string;
    callId?: Id<"calls">;
  },
): Promise<void> {
  const phone = args.rawPhone ? toE164(args.rawPhone) : null;
  if (!phone) return;
  if (await isOptedOut(ctx, args.workspaceId, phone)) return;
  await ctx.db.insert("voiceOptOuts", {
    workspaceId: args.workspaceId,
    phone,
    reason: args.reason,
    callId: args.callId,
    createdAt: Date.now(),
  });
}

/** Close the campaign once no call is pending or in flight. */
async function maybeFinishCampaign(
  ctx: MutationCtx,
  campaignId: Id<"qualifierCampaigns">,
  excludeCallId?: Id<"calls">,
): Promise<void> {
  const siblings = await ctx.db
    .query("calls")
    .withIndex("by_qualifier_campaign", (q) => q.eq("qualifierCampaignId", campaignId))
    .collect();
  const unfinished = siblings.filter(
    (s) =>
      s._id !== excludeCallId &&
      !s.isTest &&
      (s.status === "pending" || s.status === "in_progress"),
  );
  if (unfinished.length === 0) {
    await ctx.db.patch(campaignId, { status: "completed", statusNote: undefined });
  }
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
    businessName: v.optional(v.string()),
    voice: v.optional(v.string()),
    backgroundTrack: v.optional(v.string()),
    leadIds: v.array(v.id("leads")),
    engine: engineArg,
  },
  handler: async (ctx, args) => {
    await assertPlanDb(ctx, "personal", "AI Cold Calling");
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
      businessName: args.businessName?.trim().slice(0, 80) || undefined,
      voice: args.voice,
      backgroundTrack: args.backgroundTrack,
      engine: args.engine,
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

/** A dispatcher's claim on a pending row expires after this (crashed run). */
const CLAIM_TTL_MS = 10 * 60 * 1000;
/** Qualifier calls are capped at 5 minutes (sendCall max_duration). */
const QUALIFIER_MAX_CALL_SEC = 5 * 60;

/**
 * Everything the dispatcher needs to place this campaign's calls — only for
 * the workspace that owns it. `now` comes from the action (queries must
 * stay deterministic).
 */
export const getQualifierDispatch = internalQuery({
  args: {
    campaignId: v.id("qualifierCampaigns"),
    workspaceId: v.id("workspaces"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.workspaceId !== args.workspaceId) return null;
    const workspace = await ctx.db.get(campaign.workspaceId);
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
      location: string | null;
      optedOut: boolean;
    }[] = [];
    for (const row of rows) {
      if (row.isTest) continue;
      // "in_progress with no Bland id" = legacy stub rows from before
      // dispatch existed — treat them as never called.
      const undialed =
        row.status === "pending" ||
        (row.status === "in_progress" && !row.blandCallId);
      if (!undialed) continue;
      // Another dispatch run is placing this one right now.
      if (row.dispatchClaimedAt && args.now - row.dispatchClaimedAt < CLAIM_TTL_MS) continue;
      const lead = row.leadId ? await ctx.db.get(row.leadId) : null;
      if (!lead?.phone) continue;
      pending.push({
        callId: row._id,
        phone: lead.phone,
        name: lead.name ?? null,
        company: lead.company ?? null,
        location: lead.location ?? null,
        optedOut: await isOptedOut(ctx, campaign.workspaceId, lead.phone),
      });
    }
    // Studio HD campaigns dial from the workspace's own imported number.
    const engine = campaign.engine ?? "bland";
    const outboundNumber =
      engine === "elevenlabs"
        ? (
            await ctx.db
              .query("phoneNumbers")
              .withIndex("by_workspace", (q) => q.eq("workspaceId", campaign.workspaceId))
              .collect()
          ).find((n) => n.status === "active" && n.elevenPhoneNumberId)
        : undefined;
    return {
      name: campaign.name,
      engine,
      elevenAgentId: campaign.elevenAgentId ?? null,
      elevenPhoneNumberId: outboundNumber?.elevenPhoneNumberId ?? null,
      prompt: campaign.prompt,
      callerName: campaign.callerName ?? null,
      businessName: campaign.businessName?.trim() || workspace?.name || "our team",
      timezone: campaign.timezone ?? "America/New_York",
      voice: campaign.voice ?? null,
      backgroundTrack: campaign.backgroundTrack ?? null,
      status: campaign.status,
      consentAttestedAt: campaign.consentAttestedAt ?? null,
      pending,
    };
  },
});

/**
 * Record the TCPA attestation (and the fallback calling-hours zone) and
 * flip the campaign to running. Only the owning workspace may do this.
 */
export const attestAndStartQualifierCampaign = internalMutation({
  args: { campaignId: v.id("qualifierCampaigns"), timezone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user, workspace } = await requireWorkspaceStrict(ctx);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.workspaceId !== workspace._id) {
      throw new Error("Campaign not found");
    }
    if (campaign.status === "completed") {
      throw new Error("This campaign already finished — create a new one to call again.");
    }
    await ctx.db.patch(campaign._id, {
      consentAttestedAt: Date.now(),
      consentAttestedBy: user._id,
      ...(args.timezone && { timezone: args.timezone }),
      status: "running",
      statusNote: undefined,
    });
    return { workspaceId: workspace._id };
  },
});

/**
 * Atomically claim up to as many in-window calls as the balance covers at
 * the 5-minute cap (calls already in flight are reserved first), and close
 * out leads on the do-not-call list. Returns what may be dialed now.
 */
export const claimQualifierBatch = internalMutation({
  args: {
    campaignId: v.id("qualifierCampaigns"),
    workspaceId: v.id("workspaces"),
    callIds: v.array(v.id("calls")),
    optedOutCallIds: v.array(v.id("calls")),
    now: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    claimed: Id<"calls">[];
    unaffordable: number;
    inFlight: number;
    maxCallCost: number;
    balance: number;
  }> => {
    const campaign = await ctx.db.get(args.campaignId);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!campaign || !workspace || campaign.workspaceId !== args.workspaceId) {
      throw new Error("Campaign not found");
    }
    const perSecond = await getConfigValue(ctx, "voiceCreditsPerSecond");
    const maxCallCost = Math.max(1, Math.ceil(QUALIFIER_MAX_CALL_SEC * perSecond));
    const doNotCall = { summary: "Not called — this number is on your do-not-call list." };

    for (const callId of args.optedOutCallIds) {
      const row = await ctx.db.get(callId);
      if (!row || row.qualifierCampaignId !== args.campaignId || row.status !== "pending") continue;
      await ctx.db.patch(callId, { status: "failed", result: doNotCall });
    }

    if (campaign.status !== "running") {
      return { claimed: [], unaffordable: 0, inFlight: 0, maxCallCost, balance: workspace.credits };
    }

    // Reserve worst-case cost for qualifier calls already ringing.
    const recent = await ctx.db
      .query("calls")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(500);
    const inFlight = recent.filter(
      (c) =>
        c.kind === "qualifier" &&
        !c.isTest &&
        (c.status === "in_progress" ||
          (c.status === "pending" &&
            c.dispatchClaimedAt !== undefined &&
            args.now - c.dispatchClaimedAt < CLAIM_TTL_MS)),
    ).length;
    let affordable = Math.max(
      0,
      Math.floor((workspace.credits - inFlight * maxCallCost) / maxCallCost),
    );

    const claimed: Id<"calls">[] = [];
    let unaffordable = 0;
    for (const callId of args.callIds) {
      const row = await ctx.db.get(callId);
      if (!row || row.qualifierCampaignId !== args.campaignId || row.isTest) continue;
      const undialed =
        row.status === "pending" || (row.status === "in_progress" && !row.blandCallId);
      if (!undialed) continue;
      if (row.dispatchClaimedAt && args.now - row.dispatchClaimedAt < CLAIM_TTL_MS) continue;
      const lead = row.leadId ? await ctx.db.get(row.leadId) : null;
      if (await isOptedOut(ctx, args.workspaceId, lead?.phone)) {
        await ctx.db.patch(callId, { status: "failed", result: doNotCall });
        continue;
      }
      if (affordable <= 0) {
        unaffordable++;
        continue;
      }
      affordable--;
      await ctx.db.patch(callId, { status: "pending", dispatchClaimedAt: args.now });
      claimed.push(callId);
    }
    await maybeFinishCampaign(ctx, args.campaignId);
    return { claimed, unaffordable, inFlight, maxCallCost, balance: workspace.credits };
  },
});

/**
 * Explain why a running campaign is waiting. `pause` drops it back to
 * draft (e.g. out of credits) so the user restarts it deliberately.
 */
export const setQualifierCampaignNote = internalMutation({
  args: {
    id: v.id("qualifierCampaigns"),
    workspaceId: v.id("workspaces"),
    statusNote: v.optional(v.string()),
    pause: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.id);
    if (!campaign || campaign.workspaceId !== args.workspaceId) return;
    if (campaign.status !== "running") return;
    await ctx.db.patch(args.id, {
      statusNote: args.statusNote,
      ...(args.pause && { status: "draft" as const }),
    });
  },
});

export const markCallDispatched = internalMutation({
  args: {
    callId: v.id("calls"),
    workspaceId: v.id("workspaces"),
    blandCallId: v.string(),
    engine: v.optional(v.union(v.literal("bland"), v.literal("elevenlabs"))),
  },
  handler: async (ctx, args) => {
    const callDoc = await ctx.db.get(args.callId);
    if (!callDoc || callDoc.workspaceId !== args.workspaceId) return;
    await ctx.db.patch(args.callId, {
      status: "in_progress",
      blandCallId: args.blandCallId,
      ...(args.engine === "elevenlabs" && { engine: "elevenlabs" as const }),
    });
  },
});

export const getCallDispatchState = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const callDoc = await ctx.db.get(args.callId);
    if (!callDoc) return null;
    return {
      status: callDoc.status,
      blandCallId: callDoc.blandCallId ?? null,
      engine: callDoc.engine ?? "bland",
    };
  },
});

/** Remember the ElevenLabs agent dialing for a campaign. */
export const setCampaignAgent = internalMutation({
  args: { campaignId: v.id("qualifierCampaigns"), elevenAgentId: v.string() },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (campaign) await ctx.db.patch(args.campaignId, { elevenAgentId: args.elevenAgentId });
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

/** Longest call we will ever bill (4 hours). Anything above is a bad payload. */
const MAX_BILLABLE_CALL_SEC = 4 * 60 * 60;

/**
 * Finalize a call's duration and bill credits per second. Idempotent: a call
 * that is already completed or failed is never billed again, and when the
 * caller knows which Bland call it is reconciling, it must match the record.
 */
export const completeCall = internalMutation({
  args: {
    callId: v.id("calls"),
    durationSec: v.number(),
    transcript: v.optional(v.string()),
    result: v.optional(v.any()),
    failed: v.optional(v.boolean()),
    /** Bland's id for the call being reconciled; ignored when the record has none yet. */
    blandCallId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const callDoc = await ctx.db.get(args.callId);
    if (!callDoc) return;
    if (callDoc.status === "completed" || callDoc.status === "failed") return;
    if (
      args.blandCallId &&
      callDoc.blandCallId &&
      callDoc.blandCallId !== args.blandCallId
    ) {
      console.warn(
        `completeCall: Bland call ${args.blandCallId} does not belong to record ${args.callId}; ignored`,
      );
      return;
    }
    const durationSec = Math.min(
      MAX_BILLABLE_CALL_SEC,
      Math.max(0, Math.round(Number.isFinite(args.durationSec) ? args.durationSec : 0)),
    );
    const perSecond = await getConfigValue(ctx, "voiceCreditsPerSecond");
    // Browser tests are never billed.
    const credits =
      args.failed || callDoc.isTest ? 0 : Math.ceil(durationSec * perSecond);
    // The call already happened, so it is always finalized: bill what the
    // balance covers and record the rest instead of throwing (a throw here
    // would leave the call unbilled and stuck in_progress forever).
    let charged = 0;
    let shortfall = 0;
    if (credits > 0) {
      const workspace = await ctx.db.get(callDoc.workspaceId);
      charged = Math.min(credits, Math.max(0, Math.floor(workspace?.credits ?? 0)));
      shortfall = credits - charged;
      if (charged > 0) {
        await spendCredits(ctx, {
          workspaceId: callDoc.workspaceId,
          amount: charged,
          feature: callDoc.kind === "receptionist" ? "receptionist" : "qualifier",
          description: shortfall
            ? `${callDoc.kind} call — ${durationSec}s (${shortfall} credits unbilled: balance ran out)`
            : `${callDoc.kind} call — ${durationSec}s`,
          meta: shortfall ? { callId: args.callId, shortfall } : undefined,
        });
      }
      if (shortfall > 0) {
        console.warn(
          `completeCall: workspace ${callDoc.workspaceId} short ${shortfall} credits on call ${args.callId}`,
        );
      }
    }
    await ctx.db.patch(args.callId, {
      status: args.failed ? "failed" : "completed",
      durationSec,
      costCredits: charged,
      ...(shortfall > 0 && { unbilledCredits: shortfall }),
      transcript: args.transcript,
      result: args.result,
    });
    // A lead who refused or asked not to be called goes on the internal
    // do-not-call list; no campaign in this workspace dials them again.
    if (
      callDoc.kind === "qualifier" &&
      !callDoc.isTest &&
      callDoc.leadId &&
      transcriptHasOptOut(args.transcript)
    ) {
      const lead = await ctx.db.get(callDoc.leadId);
      await addOptOut(ctx, {
        workspaceId: callDoc.workspaceId,
        rawPhone: lead?.phone,
        reason: "Refused or asked not to be called (detected on call)",
        callId: args.callId,
      });
    }
    // Extract booking details / outcome from the transcript with AI.
    if (!args.failed && args.transcript && args.transcript.trim()) {
      await ctx.scheduler.runAfter(0, internal.ai.analyzeCall, {
        callId: args.callId,
      });
    }
    // Last call in a qualifier campaign finishes the campaign (rehearsals
    // don't count — a test must never flip a draft to "completed").
    if (callDoc.qualifierCampaignId && !callDoc.isTest) {
      await maybeFinishCampaign(ctx, callDoc.qualifierCampaignId, args.callId);
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
    engine: engineArg,
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
      ...(args.engine === "elevenlabs" && { engine: "elevenlabs" as const }),
    });
  },
});

/** Agents of live Studio HD receptionists — the inbound sweep's input. */
export const liveElevenReceptionistAgents = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out: string[] = [];
    for (const r of await ctx.db.query("receptionists").collect()) {
      if (r.engine === "elevenlabs" && r.status === "live" && r.elevenAgentId) {
        out.push(r.elevenAgentId);
      }
    }
    return out;
  },
});

// ── Call records + AI analysis ──────────────────────────────────────────

/** Record a qualifier browser rehearsal the moment it starts. */
export const createQualifierBrowserCall = internalMutation({
  args: {
    blandCallId: v.optional(v.string()),
    campaignId: v.id("qualifierCampaigns"),
    /** ElevenLabs tests: the throwaway agent the session talks to. */
    elevenAgentId: v.optional(v.string()),
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
      ...(args.elevenAgentId && {
        engine: "elevenlabs" as const,
        elevenAgentId: args.elevenAgentId,
      }),
    });
  },
});

/** Record a browser test session the moment it starts. */
export const createBrowserCall = internalMutation({
  args: {
    blandCallId: v.optional(v.string()),
    receptionistId: v.id("receptionists"),
    elevenAgentId: v.optional(v.string()),
  },
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
      ...(args.elevenAgentId && {
        engine: "elevenlabs" as const,
        elevenAgentId: args.elevenAgentId,
      }),
    });
  },
});

/**
 * Link an ElevenLabs browser test to its conversation once known. Only an
 * open test record with no conversation yet; the caller has already checked
 * the conversation belongs to the record's throwaway agent.
 */
export const attachTestConversation = internalMutation({
  args: { callId: v.id("calls"), conversationId: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const callDoc = await ctx.db.get(args.callId);
    if (!callDoc?.isTest || callDoc.engine !== "elevenlabs") return false;
    if (callDoc.status !== "in_progress") return false;
    if (callDoc.blandCallId && callDoc.blandCallId !== args.conversationId) return false;
    await ctx.db.patch(args.callId, { blandCallId: args.conversationId });
    return true;
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
