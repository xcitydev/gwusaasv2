import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  blandConfigured,
  purchaseNumber,
  configureInbound,
  createWebAgent,
  authorizeWebAgent,
  getCallDetails,
  sendCall,
} from "./lib/bland";

/**
 * "Test in browser": spin up a throwaway Bland web agent with the current
 * (possibly unsaved) prompt and hand the client a single-use session token.
 * The browser SDK connects mic + speakers directly to the agent.
 */
type VoiceProvider = "bland" | "elevenlabs";

const providerValidator = v.union(v.literal("bland"), v.literal("elevenlabs"));

type VoiceOption = {
  id: string;
  name: string;
  description: string | null;
  curated: boolean;
  owned: boolean;
  provider: VoiceProvider;
};

/**
 * Voices the account can use, best first (curated V3 = studio quality).
 * `includeElevenLabs` adds the workspace's ElevenLabs clones — only for
 * text-to-speech surfaces (voices page, IG voice notes). Call pickers leave
 * it off: phone calls run on Bland and can't speak an ElevenLabs voice.
 */
export const listVoices = action({
  args: { includeElevenLabs: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<VoiceOption[]> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const clones = await ctx.runQuery(internal.voice.listWorkspaceClones, {});
    const elevenClones: VoiceOption[] = args.includeElevenLabs
      ? clones
          .filter((c) => c.provider === "elevenlabs")
          .map((c) => ({
            id: c.voiceId,
            name: c.name,
            description: "Your voice — ElevenLabs clone",
            curated: false,
            owned: true,
            provider: "elevenlabs" as const,
          }))
      : [];
    if (!blandConfigured()) return elevenClones;
    const { listVoices: fetchVoices } = await import("./lib/bland");
    const voices = await fetchVoices();
    const ownedSet = new Set(
      clones.filter((c) => c.provider === "bland").map((c) => c.voiceId),
    );
    const blandVoices = voices
      .map((voice) => ({
        id: voice.id,
        name: voice.name,
        description: voice.description,
        curated: voice.tags?.includes("Bland Curated") ?? false,
        owned: ownedSet.has(voice.id),
        isPublic: voice.public,
        service: voice.service,
      }))
      // The Bland account is platform-wide: show CURATED studio voices to
      // everyone (the full public library is 900+ entries — unusable), and
      // private clones only to the workspace that made them.
      .filter((voice) => voice.owned || (voice.isPublic && voice.curated))
      .sort((a, b) => {
        if (a.owned !== b.owned) return a.owned ? -1 : 1;
        if (a.curated !== b.curated) return a.curated ? -1 : 1;
        if ((a.service === "BTTS_V3") !== (b.service === "BTTS_V3")) {
          return a.service === "BTTS_V3" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      })
      .map(({ id, name, description, curated, owned }) => ({
        id,
        name,
        description,
        curated,
        owned,
        provider: "bland" as const,
      }));
    return [...elevenClones, ...blandVoices];
  },
});

/**
 * Clone the user's voice from a browser recording (uploaded to storage as
 * WAV) on the chosen engine. Bland's V3 engine wants one ~10s clean sample
 * and its clones work everywhere, calls included. ElevenLabs improves with
 * a minute or more and is TTS-only (previews, IG voice notes).
 */
export const cloneMyVoice = action({
  args: {
    name: v.string(),
    storageId: v.id("_storage"),
    gender: v.optional(v.string()),
    provider: v.optional(providerValidator),
  },
  handler: async (ctx, args): Promise<{ voiceId: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const provider: VoiceProvider = args.provider ?? "bland";
    const { elevenConfigured, cloneVoice: elevenClone } = await import(
      "./lib/elevenlabs"
    );
    if (provider === "elevenlabs" ? !elevenConfigured() : !blandConfigured()) {
      throw new Error(
        provider === "elevenlabs"
          ? "NOT_CONFIGURED: ElevenLabs isn't connected yet (ELEVENLABS_API_KEY)."
          : "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    const name = args.name.trim().slice(0, 30);
    if (!name) throw new Error("Give your voice a name");
    const audio = await ctx.storage.get(args.storageId);
    if (!audio) throw new Error("Recording not found — try recording again");
    if (audio.size > 10 * 1024 * 1024) {
      throw new Error("Recording is over 10MB — keep it shorter");
    }
    let voiceId: string;
    if (provider === "elevenlabs") {
      voiceId = await elevenClone({
        name,
        audio,
        filename: "sample.wav",
        gender: args.gender,
        description: "Cloned in-app from a browser recording",
      });
    } else {
      const { cloneVoice } = await import("./lib/bland");
      voiceId = await cloneVoice({
        name,
        audio,
        filename: "sample.wav",
        gender: args.gender,
        description: "Cloned in-app from a browser recording",
      });
    }
    await ctx.runMutation(internal.voice.recordClonedVoice, {
      voiceId,
      name,
      provider,
    });
    return { voiceId };
  },
});

/** Delete one of this workspace's cloned voices (frees a clone slot). */
export const deleteClonedVoice = action({
  args: { voiceId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const clones = await ctx.runQuery(internal.voice.listWorkspaceClones, {});
    const clone = clones.find((c) => c.voiceId === args.voiceId);
    if (!clone) throw new Error("That voice isn't in your workspace");
    if (clone.provider === "elevenlabs") {
      const { deleteVoice } = await import("./lib/elevenlabs");
      await deleteVoice(args.voiceId);
    } else {
      const { deleteVoice } = await import("./lib/bland");
      await deleteVoice(args.voiceId);
    }
    await ctx.runMutation(internal.voice.removeClonedVoice, {
      voiceId: args.voiceId,
    });
  },
});

const DEFAULT_PREVIEW_LINE =
  "Hi! This is how I'll sound on your calls. Looking forward to talking to your customers.";

/**
 * A short spoken sample of one voice (base64 + its mime) for in-app
 * preview. Pass `text` to hear your own line — how the voices page compares
 * clones from both engines saying the same thing.
 */
export const voicePreview = action({
  args: { voiceId: v.string(), text: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ audioBase64: string; mime: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const text = (args.text?.trim() || DEFAULT_PREVIEW_LINE).slice(0, 300);
    // Only the caller's own ElevenLabs clones route to ElevenLabs.
    const clones = await ctx.runQuery(internal.voice.listWorkspaceClones, {});
    const clone = clones.find((c) => c.voiceId === args.voiceId);
    if (clone?.provider === "elevenlabs") {
      const { elevenConfigured, ttsMp3, bytesToBase64 } = await import(
        "./lib/elevenlabs"
      );
      if (!elevenConfigured()) {
        throw new Error(
          "NOT_CONFIGURED: ElevenLabs isn't connected yet (ELEVENLABS_API_KEY).",
        );
      }
      const audio = await ttsMp3(args.voiceId, text);
      return { audioBase64: bytesToBase64(audio), mime: "audio/mpeg" };
    }
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    const { ttsPreview } = await import("./lib/bland");
    return { audioBase64: await ttsPreview(args.voiceId, text), mime: "audio/wav" };
  },
});

export const startBrowserTest = action({
  args: {
    receptionistId: v.id("receptionists"),
    prompt: v.string(),
    voice: v.string(),
    backgroundTrack: v.optional(v.string()),
    greeting: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    agentId: string;
    sessionToken: string;
    blandCallId: string;
    callRecordId: Id<"calls">;
  }> => {
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    if (!args.prompt.trim()) throw new Error("Write a prompt first");
    const blandCallId = crypto.randomUUID();
    const callRecordId: Id<"calls"> = await ctx.runMutation(
      internal.voice.createBrowserCall,
      { blandCallId, receptionistId: args.receptionistId },
    );
    // Web sessions can't carry metadata, so the webhook URL itself links the
    // Bland call back to our record.
    const site = process.env.CONVEX_SITE_URL;
    const agentId = await createWebAgent({
      prompt: args.prompt,
      voice: args.voice,
      firstSentence: args.greeting,
      backgroundTrack: args.backgroundTrack,
      webhookUrl: site
        ? `${site}/bland-webhook?callRecordId=${callRecordId}`
        : undefined,
    });
    const sessionToken = await authorizeWebAgent(agentId);
    // Safety net: if the tab closes without a clean hang-up, finalize anyway.
    await ctx.scheduler.runAfter(15 * 60 * 1000, internal.voiceActions.finalizeBrowserCall, {
      callRecordId,
      blandCallId,
      attempt: 3,
    });
    return { agentId, sessionToken, blandCallId, callRecordId };
  },
});

/**
 * Called when the user hangs up a browser test. The browser collects the
 * transcript live from SDK events; when it has one, we finalize immediately.
 * Otherwise the Bland webhook (or the polling fallback) fills it in.
 */
export const endBrowserTest = action({
  args: {
    callRecordId: v.id("calls"),
    blandCallId: v.string(),
    clientTranscript: v.optional(v.string()),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    if (args.clientTranscript?.trim()) {
      await ctx.runMutation(internal.voice.completeCall, {
        callId: args.callRecordId,
        durationSec: Math.max(0, Math.round(args.durationSec ?? 0)),
        transcript: args.clientTranscript,
      });
      return;
    }
    // No client-side transcript — give Bland a moment, then try the API/webhook.
    await ctx.scheduler.runAfter(6000, internal.voiceActions.finalizeBrowserCall, {
      callRecordId: args.callRecordId,
      blandCallId: args.blandCallId,
      attempt: 2,
    });
  },
});

export const finalizeBrowserCall = internalAction({
  args: {
    callRecordId: v.id("calls"),
    blandCallId: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    // Already finalized by an earlier path (hang-up vs safety net)? Done.
    const existing = await ctx.runQuery(internal.voice.getCallForAnalysis, {
      callId: args.callRecordId,
    });
    if (!existing || existing.status !== "in_progress") return;
    try {
      const details = await getCallDetails(args.blandCallId);
      if (!details.transcript.trim() && args.attempt < 3) {
        await ctx.scheduler.runAfter(6000, internal.voiceActions.finalizeBrowserCall, {
          ...args,
          attempt: args.attempt + 1,
        });
        return;
      }
      await ctx.runMutation(internal.voice.completeCall, {
        callId: args.callRecordId,
        durationSec: details.durationSec,
        transcript: details.transcript || undefined,
      });
    } catch (error) {
      if (args.attempt < 3) {
        await ctx.scheduler.runAfter(6000, internal.voiceActions.finalizeBrowserCall, {
          ...args,
          attempt: args.attempt + 1,
        });
        return;
      }
      console.error("Browser call finalize failed:", error);
      await ctx.runMutation(internal.voice.completeCall, {
        callId: args.callRecordId,
        durationSec: 0,
        failed: true,
      });
    }
  },
});

/** Browse the numbers actually in stock, priced in the user's credits. */
export const listAvailable = action({
  args: { areaCode: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    numbers: { phone_number: string; friendly_name: string; location: string }[];
    priceCredits: number;
  }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    const { listAvailableNumbers } = await import("./lib/bland");
    const [numbers, price] = await Promise.all([
      listAvailableNumbers(args.areaCode),
      ctx.runQuery(internal.voice.numberPrice, {}),
    ]);
    return { numbers, priceCredits: price.credits };
  },
});

/** Buy a phone number: charge credits, purchase upstream, refund on failure. */
export const buyNumber = action({
  args: {
    areaCode: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"phoneNumbers">; number: string }> => {
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    const [{ credits }, isAdmin] = await Promise.all([
      ctx.runMutation(internal.voice.chargeForNumber, {}),
      ctx.runQuery(internal.voice.callerIsAdmin, {}),
    ]);
    let number: string;
    try {
      number = await purchaseNumber({
        areaCode: args.areaCode,
        phoneNumber: args.phoneNumber,
        revealOpsErrors: isAdmin,
      });
    } catch (error) {
      await ctx.runMutation(internal.voice.refundNumberCharge, { credits });
      throw error;
    }
    const id = await ctx.runMutation(internal.voice.recordNumber, {
      number,
      monthlyCostUsd: 15,
    });
    return { id, number };
  },
});

/**
 * The campaign brief is the user's; the calling craft is ours. Without this
 * framework the AI treats the brief as a checklist and gives up on the first
 * "no" (observed live) instead of probing like a real SDR.
 */
function buildQualifierTask(opts: {
  prompt: string;
  callerName: string;
  context: string;
}): string {
  return [
    `You are a warm, professional outbound caller. Your name is ${opts.callerName}. Follow the campaign brief below together with these calling rules:`,
    `- Open by introducing yourself by name and who you're calling on behalf of ("Hi, this is ${opts.callerName}, calling on behalf of …"), then confirm you're speaking with the right person.`,
    "- Get curious about THEIR business before firing qualifying questions.",
    "- Never end the call on a first 'no'. Acknowledge it, then ask one discovery question to understand their situation — how they get customers today, what's working, what's frustrating.",
    "- If a qualifying criterion isn't met, probe once for future intent ('is that something you're considering in the next few months?') before wrapping up.",
    "- Handle objections with one thoughtful, value-focused response. Never argue twice, never sound pushy.",
    "- Only end after two genuine refusals — and always leave the door open warmly.",
    "- If you reach voicemail, leave a one-sentence message and end the call.",
    "",
    "CAMPAIGN BRIEF:",
    opts.prompt,
    "",
    opts.context,
  ].join("\n");
}

/**
 * Browser rehearsal for a qualifier campaign: talk to the exact agent your
 * leads will get — you play the lead. Free (browser tests are never billed).
 */
export const startQualifierBrowserTest = action({
  args: { campaignId: v.id("qualifierCampaigns") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    agentId: string;
    sessionToken: string;
    blandCallId: string;
    callRecordId: Id<"calls">;
  }> => {
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    const dispatch = await ctx.runQuery(internal.voice.getQualifierDispatch, {
      campaignId: args.campaignId,
    });
    if (!dispatch) throw new Error("Campaign not found");
    const task = buildQualifierTask({
      prompt: dispatch.prompt,
      callerName: dispatch.callerName ?? "Maya",
      context:
        "Context: this is a browser rehearsal — the person you're speaking to is role-playing a lead so they can hear how you handle the call. Treat them exactly like a real lead.",
    });
    const blandCallId = crypto.randomUUID();
    const callRecordId: Id<"calls"> = await ctx.runMutation(
      internal.voice.createQualifierBrowserCall,
      { blandCallId, campaignId: args.campaignId },
    );
    const site = process.env.CONVEX_SITE_URL;
    const agentId = await createWebAgent({
      prompt: task,
      voice: dispatch.voice ?? "maya",
      backgroundTrack: dispatch.backgroundTrack ?? undefined,
      webhookUrl: site
        ? `${site}/bland-webhook?callRecordId=${callRecordId}`
        : undefined,
    });
    const sessionToken = await authorizeWebAgent(agentId);
    await ctx.scheduler.runAfter(
      15 * 60 * 1000,
      internal.voiceActions.finalizeBrowserCall,
      { callRecordId, blandCallId, attempt: 3 },
    );
    return { agentId, sessionToken, blandCallId, callRecordId };
  },
});

/** Dial every undialed lead in a qualifier campaign. */
export const startQualifierCampaign = action({
  args: { campaignId: v.id("qualifierCampaigns") },
  handler: async (
    ctx,
    args,
  ): Promise<{ dispatched: number; skipped: number }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    const dispatch = await ctx.runQuery(internal.voice.getQualifierDispatch, {
      campaignId: args.campaignId,
    });
    if (!dispatch) throw new Error("Campaign not found");
    if (dispatch.pending.length === 0) {
      throw new Error(
        "Nothing left to call — every lead was already dialed or has no phone number.",
      );
    }
    await ctx.runMutation(internal.voice.setQualifierCampaignStatus, {
      id: args.campaignId,
      status: "running",
    });
    const webhookUrl = process.env.CONVEX_SITE_URL
      ? `${process.env.CONVEX_SITE_URL}/bland-webhook`
      : undefined;
    let dispatched = 0;
    let skipped = 0;
    for (const target of dispatch.pending) {
      const task = buildQualifierTask({
        prompt: dispatch.prompt,
        callerName: dispatch.callerName ?? "Maya",
        context: `Context: you are calling ${target.name ?? "a lead"}${target.company ? ` at ${target.company}` : ""}.`,
      });
      try {
        const blandCallId = await sendCall({
          phoneNumber: target.phone,
          task,
          voice: dispatch.voice ?? undefined,
          backgroundTrack: dispatch.backgroundTrack ?? undefined,
          webhookUrl,
          metadata: { convexCallId: target.callId },
          maxDurationMin: 5,
        });
        await ctx.runMutation(internal.voice.markCallDispatched, {
          callId: target.callId,
          blandCallId,
        });
        dispatched++;
        // Safety net if the completion webhook never arrives.
        await ctx.scheduler.runAfter(
          5 * 60 * 1000,
          internal.voiceActions.pollQualifierCall,
          { callId: target.callId, attempt: 1 },
        );
      } catch (error) {
        console.error("Qualifier dispatch failed:", target.phone, error);
        await ctx.runMutation(internal.voice.completeCall, {
          callId: target.callId,
          durationSec: 0,
          failed: true,
        });
        skipped++;
      }
    }
    return { dispatched, skipped };
  },
});

/** Poll Bland for a dispatched call the webhook hasn't closed out yet. */
export const pollQualifierCall = internalAction({
  args: { callId: v.id("calls"), attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const state = await ctx.runQuery(internal.voice.getCallDispatchState, {
      callId: args.callId,
    });
    // Webhook already handled it (or the call vanished) — nothing to do.
    if (!state || state.status !== "in_progress" || !state.blandCallId) return;
    try {
      const details = await getCallDetails(state.blandCallId);
      if (details.completed) {
        await ctx.runMutation(internal.voice.completeCall, {
          callId: args.callId,
          durationSec: details.durationSec,
          transcript: details.transcript || undefined,
        });
        return;
      }
    } catch (error) {
      console.error("Qualifier poll failed:", error);
    }
    if (args.attempt < 4) {
      await ctx.scheduler.runAfter(
        5 * 60 * 1000,
        internal.voiceActions.pollQualifierCall,
        { callId: args.callId, attempt: args.attempt + 1 },
      );
    } else {
      await ctx.runMutation(internal.voice.completeCall, {
        callId: args.callId,
        durationSec: 0,
        failed: true,
      });
    }
  },
});

/**
 * Safety-net sweep: pull recent calls from the voice engine and backfill any
 * inbound call the webhook missed. Runs on a cron; also invocable manually
 * to recover a specific missed call.
 */
export const syncInboundCalls = internalAction({
  args: {},
  handler: async (ctx): Promise<{ recovered: number }> => {
    if (!blandConfigured()) return { recovered: 0 };
    const { listRecentCalls } = await import("./lib/bland");
    const recent = await listRecentCalls(50);
    let recovered = 0;
    for (const c of recent) {
      if (!c.call_id || !c.to || c.inbound === false) continue;
      if (c.completed === false) continue; // still ringing/talking
      const known = await ctx.runQuery(internal.voice.findCallByBlandId, {
        blandCallId: c.call_id,
      });
      if (known) continue;
      const callId = await ctx.runMutation(internal.voice.recordInboundCall, {
        blandCallId: c.call_id,
        toNumber: c.to,
        fromNumber: c.from ?? undefined,
      });
      if (!callId) continue; // not one of our numbers
      const details = await getCallDetails(c.call_id);
      await ctx.runMutation(internal.voice.completeCall, {
        callId,
        durationSec: details.durationSec,
        transcript: details.transcript || undefined,
      });
      recovered++;
    }
    return { recovered };
  },
});

/** Push the saved receptionist config to a live inbound number. */
export const syncReceptionist = action({
  args: {
    phoneNumber: v.string(),
    prompt: v.string(),
    voice: v.string(),
    backgroundTrack: v.optional(v.string()),
    greeting: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<void> => {
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    await configureInbound({
      phoneNumber: args.phoneNumber,
      prompt: args.prompt,
      voice: args.voice,
      backgroundTrack: args.backgroundTrack,
      firstSentence: args.greeting,
      webhookUrl: webhookUrl(),
    });
  },
});

function webhookUrl(): string | undefined {
  const site = process.env.CONVEX_SITE_URL;
  return site ? `${site}/bland-webhook` : undefined;
}

/** Save auto-booking settings — users just paste their Cal.com booking link. */
export const saveBookingSettings = action({
  args: {
    receptionistId: v.id("receptionists"),
    autoBook: v.boolean(),
    calcomLink: v.optional(v.string()),
    bookingTimezone: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    let username: string | undefined;
    let eventSlug: string | undefined;
    const link = args.calcomLink?.trim();
    if (args.autoBook) {
      if (!link) throw new Error("Paste your Cal.com booking link first");
      const { parseCalcomLink } = await import("./lib/calcom");
      const parsed = parseCalcomLink(link);
      if (!parsed) {
        throw new Error(
          "That doesn't look like a Cal.com booking link — it should be like cal.com/yourname/15min",
        );
      }
      username = parsed.username;
      eventSlug = parsed.eventTypeSlug;
    }
    await ctx.runMutation(internal.voice.setBookingSettings, {
      receptionistId: args.receptionistId,
      autoBook: args.autoBook,
      bookingTimezone: args.bookingTimezone,
      calcomLink: link,
      calcomUsername: username,
      calcomEventSlug: eventSlug,
    });
  },
});

/**
 * Fired after call analysis finds a booking. Creates the Cal.com booking from
 * the extracted details; every skip/failure is recorded honestly on the call.
 */
export const autoBookFromCall = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, args): Promise<void> => {
    const settings = await ctx.runQuery(internal.voice.getBookingSettings, {
      callId: args.callId,
    });
    if (!settings) return;
    const analysis = (settings.call.result ?? {}) as {
      bookingMade?: boolean;
      bookingTimeIso?: string | null;
      bookingTime?: string | null;
      callerName?: string | null;
      callerPhone?: string | null;
      callerEmail?: string | null;
      bookingService?: string | null;
      bookingNotes?: string | null;
    };
    if (!analysis.bookingMade) return;

    const record = async (autoBooking: unknown) => {
      await ctx.runMutation(internal.voice.setAutoBookingResult, {
        callId: args.callId,
        autoBooking,
        notifyUserId: settings.ownerId ?? undefined,
      });
    };

    const hasLink = Boolean(settings.calcomUsername && settings.calcomEventSlug);
    const hasLegacyKey = Boolean(settings.calcomKeyEncrypted && settings.calcomEventTypeId);
    if (!settings.autoBook || (!hasLink && !hasLegacyKey)) {
      // Recorded (not silent) so a manual retry never leaves "pending" stuck.
      await record({
        status: "skipped",
        detail:
          "Auto-booking is off or no Cal.com link is saved — save booking settings, then retry.",
      });
      return;
    }

    if (!analysis.bookingTimeIso) {
      await record({
        status: "skipped",
        detail: `Couldn't pin down an exact time ("${analysis.bookingTime ?? "unspecified"}") — book it manually.`,
      });
      return;
    }
    if (!analysis.callerEmail) {
      await record({
        status: "skipped",
        detail:
          "The caller didn't leave an email, which Cal.com requires — book it manually or update the prompt to always ask for email.",
      });
      return;
    }

    try {
      const { createCalcomBooking, parseCalcomLink } = await import("./lib/calcom");
      const org = settings.calcomLink
        ? parseCalcomLink(settings.calcomLink)?.organizationSlug
        : undefined;
      const { uid } = await createCalcomBooking({
        ...(hasLink
          ? {
              username: settings.calcomUsername!,
              eventTypeSlug: settings.calcomEventSlug!,
              organizationSlug: org,
            }
          : {
              apiKey: await (await import("./lib/crypto")).decryptString(
                settings.calcomKeyEncrypted!,
              ),
              eventTypeId: Number(settings.calcomEventTypeId),
            }),
        startIsoUtc: analysis.bookingTimeIso,
        name: analysis.callerName ?? "Caller",
        email: analysis.callerEmail,
        phone: analysis.callerPhone ?? undefined,
        timeZone: settings.bookingTimezone,
        notes: [analysis.bookingService, analysis.bookingNotes]
          .filter(Boolean)
          .join(" — "),
      });
      await record({
        status: "booked",
        detail: `Scheduled for ${analysis.bookingTime ?? analysis.bookingTimeIso}`,
        uid,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Cal.com booking failed";
      // Cal's 409 wording confuses users with empty calendars — the usual
      // culprit is the requested time falling outside their Cal.com hours.
      const detail =
        raw.includes("409") || /already has booking|not available/i.test(raw)
          ? "Cal.com declined this time — either something is already booked then, or it's outside your working hours on Cal.com. Update Availability on cal.com (days, hours, timezone), then hit Book again."
          : raw;
      await record({ status: "failed", detail });
    }
  },
});
