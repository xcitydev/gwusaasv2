import { internalAction, type ActionCtx } from "./_generated/server";
import { action } from "./lib/functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  blandConfigured,
  blandWebhookUrl,
  purchaseNumber,
  configureInbound,
  createWebAgent,
  authorizeWebAgent,
  getCallDetails,
  sendCall,
  outboundDisclosure,
  toE164,
} from "./lib/bland";
import { assertPlanAction } from "./lib/plan";

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
  args: {
    includeElevenLabs: v.optional(v.boolean()),
    /**
     * Call pickers name their engine: "elevenlabs" lists only voices an
     * ElevenLabs agent can speak (your Studio HD clones + ElevenLabs' stock
     * voices); "bland"/absent lists Bland voices (+ Studio HD clones only
     * when includeElevenLabs, for text-to-speech surfaces).
     */
    engine: v.optional(providerValidator),
  },
  handler: async (ctx, args): Promise<VoiceOption[]> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const clones = await ctx.runQuery(internal.voice.listWorkspaceClones, {});
    const elevenClones: VoiceOption[] =
      args.includeElevenLabs || args.engine === "elevenlabs"
        ? clones
            .filter((c) => c.provider === "elevenlabs")
            .map((c) => ({
              id: c.voiceId,
              name: c.name,
              description: "Your voice — studio clone",
              curated: false,
              owned: true,
              provider: "elevenlabs" as const,
            }))
        : [];
    if (args.engine === "elevenlabs") {
      const { elevenConfigured, listStockVoices } = await import("./lib/elevenlabs");
      if (!elevenConfigured()) return elevenClones;
      const stock = await listStockVoices();
      return [
        ...elevenClones,
        ...stock.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          curated: true,
          owned: false,
          provider: "elevenlabs" as const,
        })),
      ];
    }
    // Pooled Bland clones live in our table (they may not be loaded on
    // Bland right now); list them from there, by their stable key.
    const blandClones: VoiceOption[] = clones
      .filter((c) => c.provider === "bland" && c.voiceId.startsWith("blv_"))
      .map((c) => ({
        id: c.voiceId,
        name: c.name,
        description: "Your voice — standard clone",
        curated: false,
        owned: true,
        provider: "bland" as const,
      }));
    if (!blandConfigured()) return [...elevenClones, ...blandClones];
    const { listVoices: fetchVoices } = await import("./lib/bland");
    const voices = await fetchVoices();
    // Pre-pool clones are matched by their raw Bland id.
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
    return [...elevenClones, ...blandClones, ...blandVoices];
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
    /** "This is my own voice, or I have the speaker's written permission." */
    consentAttested: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ voiceId: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (args.consentAttested !== true) {
      throw new Error(
        "Confirm this is your own voice, or that you have the speaker's written permission to clone it.",
      );
    }
    const consentAttestedAt = Date.now();
    await assertPlanAction(ctx, "personal", "Clone Your Voice");
    const provider: VoiceProvider = args.provider ?? "bland";
    const { elevenConfigured } = await import("./lib/elevenlabs");
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
    // Pooled on both engines: keep the recording, load it upstream now (so a
    // bad recording fails here, not on the first call), and let the pool
    // unload/reload it as the plan's clone slots are needed. Each "Both"
    // clone gets its own copy of the recording, so deleting one engine's
    // clone never removes the other's sample.
    const { newPooledVoiceKey, ensurePooledVoice } = await import("./lib/voicePool");
    const sampleStorageId = await ctx.storage.store(audio);
    const voiceId = newPooledVoiceKey(provider);
    await ctx.runMutation(internal.voice.recordClonedVoice, {
      voiceId,
      name,
      provider,
      consentAttestedAt,
      sampleStorageId,
    });
    try {
      await ensurePooledVoice(ctx, voiceId);
    } catch (error) {
      // Every slot is busy right now (someone mid-call): keep the clone and
      // its recording — it loads the first time it's used. Anything else
      // (a recording the engine rejects, no free slot at all) fails here.
      if (error instanceof Error && error.message.includes("VOICE_POOL_BUSY")) {
        return { voiceId };
      }
      await ctx.runMutation(internal.voice.removeClonedVoice, { voiceId });
      await ctx.storage.delete(sampleStorageId);
      throw error;
    }
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
    if (await ctx.runQuery(internal.voicePool.isPinned, { voiceId: args.voiceId })) {
      throw new Error(
        "This voice is on a live receptionist or a running campaign — switch that to another voice first.",
      );
    }
    const { pooledProvider, releasePooledVoice } = await import("./lib/voicePool");
    if (pooledProvider(args.voiceId)) {
      await releasePooledVoice(ctx, args.voiceId);
    } else if (clone.provider === "elevenlabs") {
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
    const { pooledProvider, withPooledVoice } = await import("./lib/voicePool");
    const pooled = pooledProvider(args.voiceId);
    // Cloned voices only for their own workspace; library voices for anyone.
    const scope = pooled
      ? { workspaceId: (await ctx.runQuery(internal.voice.getCallerWorkspace, {})).workspaceId }
      : undefined;
    // Pre-pool ElevenLabs clones keep their raw ElevenLabs id.
    const legacyEleven =
      !pooled &&
      (await ctx.runQuery(internal.voice.listWorkspaceClones, {})).some(
        (c) => c.voiceId === args.voiceId && c.provider === "elevenlabs",
      );
    // ElevenLabs stock voices (Studio HD call pickers) have bare 20-char ids.
    if (pooled === "elevenlabs" || legacyEleven || (!pooled && ELEVEN_LIBRARY_ID.test(args.voiceId))) {
      const { elevenConfigured, ttsMp3, bytesToBase64 } = await import(
        "./lib/elevenlabs"
      );
      if (!elevenConfigured()) {
        throw new Error(
          "NOT_CONFIGURED: ElevenLabs isn't connected yet (ELEVENLABS_API_KEY).",
        );
      }
      const audio = await withPooledVoice(
        ctx,
        args.voiceId,
        (remote) => ttsMp3(remote, text),
        scope,
      );
      return { audioBase64: bytesToBase64(audio), mime: "audio/mpeg" };
    }
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    const { ttsPreview } = await import("./lib/bland");
    const audioBase64 = await withPooledVoice(
      ctx,
      args.voiceId,
      (remote) => ttsPreview(remote, text),
      scope,
    );
    return { audioBase64, mime: "audio/wav" };
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
    await assertPlanAction(ctx, "personal", "AI Receptionist");
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    if (!args.prompt.trim()) throw new Error("Write a prompt first");
    const { workspaceId } = await ctx.runQuery(internal.voice.getCallerWorkspace, {});
    const { resolveVoice } = await import("./lib/voicePool");
    const voice = await resolveVoice(ctx, assertBlandVoice(args.voice), {
      workspaceId,
      holdMs: BROWSER_TEST_HOLD_MS,
    });
    const blandCallId = crypto.randomUUID();
    const callRecordId: Id<"calls"> = await ctx.runMutation(
      internal.voice.createBrowserCall,
      { blandCallId, receptionistId: args.receptionistId },
    );
    // Web sessions can't carry metadata, so the webhook URL itself links the
    // Bland call back to our record.
    const agentId = await createWebAgent({
      prompt: args.prompt,
      voice,
      firstSentence: args.greeting,
      backgroundTrack: args.backgroundTrack,
      webhookUrl: blandWebhookUrl({ callRecordId }),
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
 * Only the caller's own, still-open TEST record can be closed this way, and
 * the client's duration is display-only (tests bill 0) and capped by the
 * record's real age.
 */
export const endBrowserTest = action({
  args: {
    callRecordId: v.id("calls"),
    blandCallId: v.string(),
    clientTranscript: v.optional(v.string()),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const test = await ctx.runQuery(internal.voice.getOwnedTestCall, {
      callId: args.callRecordId,
    });
    if (!test || !test.blandCallId || test.blandCallId !== args.blandCallId) {
      throw new Error("Test call not found");
    }
    if (test.status !== "in_progress") return;
    if (args.clientTranscript?.trim()) {
      const elapsedSec = Math.max(0, (Date.now() - test.startedAt) / 1000);
      const claimed = Number.isFinite(args.durationSec) ? (args.durationSec ?? 0) : 0;
      await ctx.runMutation(internal.voice.completeCall, {
        callId: args.callRecordId,
        blandCallId: test.blandCallId,
        durationSec: Math.round(Math.min(Math.max(0, claimed), elapsedSec)),
        transcript: args.clientTranscript.slice(0, 50_000),
      });
      return;
    }
    // No client-side transcript — give Bland a moment, then try the API/webhook.
    await ctx.scheduler.runAfter(6000, internal.voiceActions.finalizeBrowserCall, {
      callRecordId: args.callRecordId,
      blandCallId: test.blandCallId,
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

/**
 * Webhook reconciliation. The Bland webhook body is never trusted: this
 * re-reads the call from Bland's API (the only source billing uses) and then
 * finalizes the matching record. A forged poke can at most trigger a re-read
 * of a real call, which completeCall ignores once the record is finalized.
 */
export const reconcileFromWebhook = internalAction({
  args: {
    blandCallId: v.optional(v.string()),
    callRecordId: v.optional(v.id("calls")),
  },
  handler: async (ctx, args): Promise<void> => {
    let callRecordId: Id<"calls"> | null = args.callRecordId ?? null;
    let blandCallId: string | null = args.blandCallId ?? null;

    if (callRecordId) {
      const existing = await ctx.runQuery(internal.voice.getCallForAnalysis, {
        callId: callRecordId,
      });
      if (!existing) return; // unknown or forged record id
      if (existing.status === "completed" || existing.status === "failed") return;
      if (existing.blandCallId) {
        if (blandCallId && blandCallId !== existing.blandCallId) {
          console.warn(
            `reconcileFromWebhook: call ${blandCallId} does not belong to record ${callRecordId}; ignored`,
          );
          return;
        }
        blandCallId = existing.blandCallId;
      }
    } else if (blandCallId) {
      callRecordId = await ctx.runQuery(internal.voice.findCallByBlandId, { blandCallId });
      if (callRecordId) {
        // Replays of a finished call must not even cost us a Bland API read.
        const existing = await ctx.runQuery(internal.voice.getCallForAnalysis, {
          callId: callRecordId,
        });
        if (!existing || existing.status === "completed" || existing.status === "failed") return;
      }
    }
    if (!blandCallId) return; // nothing we can verify against Bland

    let details: Awaited<ReturnType<typeof getCallDetails>>;
    try {
      details = await getCallDetails(blandCallId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`reconcileFromWebhook: Bland has no usable record for ${blandCallId}; ignored (${msg})`);
      return;
    }

    if (!callRecordId) {
      // A real inbound call: nothing pre-created a record. Only the number
      // Bland reports as dialed is trusted, never anything posted to us.
      if (!details.to) return;
      callRecordId = await ctx.runMutation(internal.voice.recordInboundCall, {
        blandCallId,
        toNumber: details.to,
        fromNumber: details.from,
      });
      if (!callRecordId) return; // not one of our numbers, or already recorded
    }

    await ctx.runMutation(internal.voice.completeCall, {
      callId: callRecordId,
      blandCallId,
      durationSec: details.durationSec,
      transcript: details.transcript || undefined,
      result: details.analysis,
      failed: details.completed === false,
    });
  },
});

/**
 * ElevenLabs webhook / sweep reconciliation. Re-reads the conversation from
 * ElevenLabs (never the posted body), then closes out the matching record:
 * a dispatched qualifier call, or — for a phone call INTO one of our numbers
 * that nothing pre-created — a new receptionist call. Browser tests are
 * finalized by their own path and are only matched, never created, here.
 */
export const reconcileElevenConversation = internalAction({
  args: { conversationId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    let callRecordId = await ctx.runQuery(internal.voice.findCallByBlandId, {
      blandCallId: args.conversationId,
    });
    if (callRecordId) {
      const existing = await ctx.runQuery(internal.voice.getCallForAnalysis, {
        callId: callRecordId,
      });
      if (!existing || existing.status === "completed" || existing.status === "failed") return;
      if (existing.isTest) return; // finalizeElevenBrowserCall owns tests
    }
    const { getConversation } = await import("./lib/elevenAgents");
    let c: Awaited<ReturnType<typeof getConversation>>;
    try {
      c = await getConversation(args.conversationId);
    } catch (error) {
      console.warn(`reconcileElevenConversation: no usable record for ${args.conversationId}`, error);
      return;
    }
    if (!c.finished) return; // a later webhook / the sweep will finish it
    if (!callRecordId) {
      if (c.direction !== "inbound" || !c.agentNumber) return;
      callRecordId = await ctx.runMutation(internal.voice.recordInboundCall, {
        blandCallId: args.conversationId,
        toNumber: c.agentNumber,
        fromNumber: c.externalNumber ?? undefined,
        engine: "elevenlabs",
      });
      if (!callRecordId) return; // not one of our numbers, or already recorded
    }
    await ctx.runMutation(internal.voice.completeCall, {
      callId: callRecordId,
      blandCallId: args.conversationId,
      durationSec: c.durationSec,
      transcript: c.transcript || undefined,
      failed: c.failed && c.durationSec === 0,
    });
  },
});

/** Browse the numbers actually in stock, priced in the user's credits. */
export const listAvailable = action({
  args: { areaCode: v.optional(v.string()), engine: v.optional(providerValidator) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    numbers: { phone_number: string; friendly_name: string; location: string }[];
    priceCredits: number;
  }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (args.engine === "elevenlabs") {
      const { twilioConfigured, listAvailableNumbers } = await import("./lib/twilio");
      if (!twilioConfigured()) {
        throw new Error(
          "NOT_CONFIGURED: Studio HD numbers need Twilio (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).",
        );
      }
      const [numbers, price] = await Promise.all([
        listAvailableNumbers(args.areaCode),
        ctx.runQuery(internal.voice.numberPrice, { engine: "elevenlabs" }),
      ]);
      return { numbers, priceCredits: price.credits };
    }
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
    engine: v.optional(providerValidator),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"phoneNumbers">; number: string }> => {
    await assertPlanAction(ctx, "personal", "AI Receptionist");
    if (args.engine === "elevenlabs") return await buyStudioNumber(ctx, args.phoneNumber);
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
 * Studio HD number: charge credits → buy on our Twilio account → import into
 * ElevenLabs Agents. Each step that succeeded is undone if a later one fails
 * (number released, credits refunded), so a failure never leaves a paid-for
 * number nobody can use.
 */
async function buyStudioNumber(
  ctx: ActionCtx,
  phoneNumber: string | undefined,
): Promise<{ id: Id<"phoneNumbers">; number: string }> {
  const twilio = await import("./lib/twilio");
  const { elevenConfigured } = await import("./lib/elevenlabs");
  if (!twilio.twilioConfigured()) {
    throw new Error(
      "NOT_CONFIGURED: Studio HD numbers need Twilio (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).",
    );
  }
  if (!elevenConfigured()) {
    throw new Error("NOT_CONFIGURED: ElevenLabs isn't connected yet (ELEVENLABS_API_KEY).");
  }
  const target = phoneNumber ? toE164(phoneNumber) : null;
  if (!target) throw new Error("Pick a number from the list first");
  const [{ credits }, price] = await Promise.all([
    ctx.runMutation(internal.voice.chargeForNumber, { engine: "elevenlabs" }),
    ctx.runQuery(internal.voice.numberPrice, { engine: "elevenlabs" }),
  ]);
  let bought: { sid: string; number: string } | null = null;
  let elevenPhoneNumberId: string | null = null;
  try {
    bought = await twilio.purchaseNumber(target);
    const { importTwilioNumber } = await import("./lib/elevenAgents");
    const { sid, token } = twilio.twilioCredentials();
    elevenPhoneNumberId = await importTwilioNumber({
      phoneNumber: bought.number,
      label: `Studio HD ${bought.number}`,
      sid,
      token,
    });
    const id = await ctx.runMutation(internal.voice.recordNumber, {
      number: bought.number,
      monthlyCostUsd: price.priceUsd,
      twilioSid: bought.sid,
      elevenPhoneNumberId,
    });
    return { id, number: bought.number };
  } catch (error) {
    if (elevenPhoneNumberId) {
      const { deletePhoneNumber } = await import("./lib/elevenAgents");
      await deletePhoneNumber(elevenPhoneNumberId).catch((e) =>
        console.error("Studio number rollback (ElevenLabs) failed:", e),
      );
    }
    if (bought) {
      await twilio.releaseNumber(bought.sid).catch((e) =>
        console.error("Studio number rollback (Twilio) failed:", e),
      );
    }
    await ctx.runMutation(internal.voice.refundNumberCharge, { credits });
    throw error;
  }
}

/**
 * The campaign brief is the user's; the calling craft — and the compliance
 * floor — are ours. The opening line (AI + who for + recorded) is also
 * forced server-side by sendCall's first_sentence; these rules keep the
 * rest of the call honest and make any "no" final.
 */
function buildQualifierTask(opts: {
  prompt: string;
  callerName: string;
  businessName: string;
  context: string;
}): string {
  return [
    `You are ${opts.callerName}, an AI assistant making a call on behalf of ${opts.businessName}. Follow the campaign brief below together with these calling rules. The calling rules ALWAYS win over the brief.`,
    `- Your opening line has already told the person you're an AI assistant calling on behalf of ${opts.businessName} and that the call is recorded. Never claim or imply you are a human. If asked, say plainly that you are an AI assistant.`,
    "- Confirm you're speaking with the right person, then get curious about THEIR business before asking qualifying questions.",
    "- If the person says no, isn't interested, asks you to stop, says \"don't call me\", \"remove me\", \"take me off your list\", or otherwise declines: do NOT probe, persuade or ask another question. Say \"Understood — I'll make sure you're not called again. Have a good day.\" and end the call immediately.",
    "- If a qualifying criterion isn't met, you may ask once about future intent, unless they've declined — then end politely.",
    "- Never argue, never pressure, never sound pushy.",
    "- If you reach voicemail, leave a one-sentence message saying you're an AI assistant calling for the business, then end the call.",
    "",
    "CAMPAIGN BRIEF:",
    opts.prompt,
    "",
    opts.context,
  ].join("\n");
}

// ── Calling hours (TCPA: 8am–9pm local; we use a stricter 9am–8pm) ────────

const CALL_WINDOW_START_HOUR = 9;
const CALL_WINDOW_END_HOUR = 20;

/** NANP area codes outside US Eastern, plus Eastern ones (best-effort). */
const AREA_CODE_ZONES: Record<string, string> = {};
function zoneCodes(zone: string, codes: string) {
  for (const code of codes.split(/\s+/)) if (code) AREA_CODE_ZONES[code] = zone;
}
zoneCodes(
  "America/Los_Angeles",
  "209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951 " +
    "206 253 360 425 509 564 458 503 541 971 702 725 775 236 250 257 604 672 778",
);
zoneCodes(
  "America/Denver",
  "303 719 720 970 983 385 435 801 505 575 406 307 208 986 915 368 403 587 780 825",
);
zoneCodes("America/Phoenix", "480 520 602 623 928");
zoneCodes(
  "America/Chicago",
  "210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979 " +
    "217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 872 218 320 507 612 651 763 952 " +
    "262 274 414 534 608 715 920 319 515 563 641 712 314 417 557 573 636 660 816 975 327 479 501 870 " +
    "225 318 337 504 985 228 601 662 769 205 251 256 334 659 938 405 539 572 580 918 316 620 785 913 " +
    "308 402 531 605 701 615 629 731 901 931 219 270 364 204 431 584",
);
zoneCodes("America/Regina", "306 474 639");
zoneCodes(
  "America/New_York",
  "212 315 332 347 363 516 518 585 607 631 646 680 716 718 838 845 914 917 929 934 201 551 609 640 732 848 856 862 908 973 " +
    "215 223 267 272 412 445 484 570 582 610 717 724 814 835 878 239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 813 850 863 904 941 954 " +
    "229 404 470 478 678 706 762 770 912 943 252 336 472 704 743 828 910 919 980 984 803 839 843 854 864 " +
    "276 434 540 571 686 703 757 804 826 948 227 240 301 410 443 667 202 771 302 339 351 413 508 617 774 781 857 978 " +
    "203 475 860 959 401 603 802 207 216 220 234 283 326 330 380 419 436 440 513 567 614 740 937 " +
    "231 248 269 313 517 586 616 679 734 810 906 947 989 260 317 463 574 765 812 930 502 606 859 423 865 304 681 " +
    "226 249 289 343 365 382 416 437 519 548 613 647 683 705 742 753 807 905 942 263 354 367 418 438 450 468 514 579 581 819 873",
);
zoneCodes("America/Halifax", "782 902 506 428");
zoneCodes("America/St_Johns", "709");
zoneCodes("America/Anchorage", "907");
zoneCodes("Pacific/Honolulu", "808");

/** US state (from a lead's "City, ST" location) → its main zone. */
const STATE_ZONES: Record<string, string> = {
  CT: "America/New_York", DC: "America/New_York", DE: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", IN: "America/New_York", KY: "America/New_York", MA: "America/New_York",
  MD: "America/New_York", ME: "America/New_York", MI: "America/New_York", NC: "America/New_York",
  NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York", OH: "America/New_York",
  PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", VA: "America/New_York",
  VT: "America/New_York", WV: "America/New_York",
  AL: "America/Chicago", AR: "America/Chicago", IA: "America/Chicago", IL: "America/Chicago",
  KS: "America/Chicago", LA: "America/Chicago", MN: "America/Chicago", MO: "America/Chicago",
  MS: "America/Chicago", ND: "America/Chicago", NE: "America/Chicago", OK: "America/Chicago",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  CO: "America/Denver", ID: "America/Denver", MT: "America/Denver", NM: "America/Denver",
  UT: "America/Denver", WY: "America/Denver", AZ: "America/Phoenix",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles",
  WA: "America/Los_Angeles", AK: "America/Anchorage", HI: "Pacific/Honolulu",
};

/** Best guess at where the lead is: their state, else area code, else the campaign's zone. */
function leadTimezone(phone: string, location: string | null, fallback: string): string {
  const state = location?.match(/,\s*([A-Z]{2})\b/)?.[1];
  if (state && STATE_ZONES[state]) return STATE_ZONES[state];
  const e164 = toE164(phone);
  if (e164?.startsWith("+1") && e164.length === 12) {
    const zone = AREA_CODE_ZONES[e164.slice(2, 5)];
    if (zone) return zone;
  }
  return fallback;
}

function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Inside 9:00–20:00 in `zone`? Fails closed (no call) if the zone is unusable. */
function withinCallingHours(zone: string, now: number): boolean {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" })
        .formatToParts(new Date(now))
        .find((p) => p.type === "hour")?.value,
    );
    return Number.isFinite(hour) && hour >= CALL_WINDOW_START_HOUR && hour < CALL_WINDOW_END_HOUR;
  } catch {
    return false;
  }
}

/** Re-check for leads waiting on their calling window this often. */
const CALLING_HOURS_RETRY_MS = 30 * 60 * 1000;
/** Most calls one action run places; the rest go to an immediate follow-up run. */
const DISPATCH_BATCH = 40;

type DispatchOutcome = {
  dispatched: number;
  skipped: number;
  deferred: number;
  optedOut: number;
  unaffordable: number;
  maxCallCost: number;
  balance: number;
};

/**
 * One dispatch pass over a running campaign: drop do-not-call numbers, hold
 * leads outside their 9am–8pm window, claim only what the balance covers,
 * dial, then schedule the next pass if anyone is still waiting.
 */
async function dispatchQualifierBatch(
  ctx: ActionCtx,
  campaignId: Id<"qualifierCampaigns">,
  workspaceId: Id<"workspaces">,
): Promise<DispatchOutcome> {
  const now = Date.now();
  const dispatch = await ctx.runQuery(internal.voice.getQualifierDispatch, {
    campaignId,
    workspaceId,
    now,
  });
  if (!dispatch) throw new Error("Campaign not found");
  const outcome: DispatchOutcome = {
    dispatched: 0,
    skipped: 0,
    deferred: 0,
    optedOut: 0,
    unaffordable: 0,
    maxCallCost: 0,
    balance: 0,
  };
  if (dispatch.status !== "running" || !dispatch.consentAttestedAt) return outcome;

  const optedOutCallIds: Id<"calls">[] = [];
  const ready: typeof dispatch.pending = [];
  for (const target of dispatch.pending) {
    if (target.optedOut) {
      optedOutCallIds.push(target.callId);
    } else if (
      withinCallingHours(leadTimezone(target.phone, target.location, dispatch.timezone), now)
    ) {
      ready.push(target);
    } else {
      outcome.deferred++;
    }
  }
  outcome.optedOut = optedOutCallIds.length;
  const batch = ready.slice(0, DISPATCH_BATCH);

  // Prepare the engine BEFORE claiming anything, so a bad voice / missing
  // number fails the pass instead of burning every claimed lead.
  const callerName = dispatch.callerName ?? "Maya";
  const { resolveVoice } = await import("./lib/voicePool");
  let blandVoice: string | undefined;
  let elevenAgentId: string | undefined;
  if (batch.length > 0 && dispatch.engine === "elevenlabs") {
    const { elevenConfigured } = await import("./lib/elevenlabs");
    if (!elevenConfigured()) {
      throw new Error("NOT_CONFIGURED: ElevenLabs isn't connected yet (ELEVENLABS_API_KEY).");
    }
    if (!dispatch.elevenPhoneNumberId) {
      throw new Error(
        "Studio HD calling dials from your own number — buy a Studio HD number on the Receptionist page first.",
      );
    }
    const voiceId = await resolveVoice(ctx, assertElevenVoice(dispatch.voice), {
      workspaceId,
      holdMs: CALL_HOLD_MS,
    });
    const { upsertAgent } = await import("./lib/elevenAgents");
    elevenAgentId = await upsertAgent(dispatch.elevenAgentId ?? undefined, {
      name: `Qualifier — ${dispatch.name}`,
      // Replaced per call by an override carrying the lead's context.
      prompt: buildQualifierTask({
        prompt: dispatch.prompt,
        callerName,
        businessName: dispatch.businessName,
        context: "",
      }),
      firstMessage: outboundDisclosure({ businessName: dispatch.businessName, callerName }),
      voiceId,
      maxDurationSec: 5 * 60,
      allowCallOverrides: true,
    });
    if (elevenAgentId !== dispatch.elevenAgentId) {
      await ctx.runMutation(internal.voice.setCampaignAgent, { campaignId, elevenAgentId });
    }
  } else if (batch.length > 0) {
    blandVoice = await resolveVoice(ctx, assertBlandVoice(dispatch.voice), {
      workspaceId,
      holdMs: CALL_HOLD_MS,
    });
  }

  const claim = await ctx.runMutation(internal.voice.claimQualifierBatch, {
    campaignId,
    workspaceId,
    callIds: batch.map((t) => t.callId),
    optedOutCallIds,
    now,
  });
  outcome.unaffordable = claim.unaffordable;
  outcome.maxCallCost = claim.maxCallCost;
  outcome.balance = claim.balance;

  const claimed = new Set(claim.claimed);
  const webhookUrl = blandWebhookUrl();
  for (const target of batch) {
    if (!claimed.has(target.callId)) continue;
    const task = buildQualifierTask({
      prompt: dispatch.prompt,
      callerName,
      businessName: dispatch.businessName,
      context: `Context: you are calling ${target.name ?? "a lead"}${target.company ? ` at ${target.company}` : ""}.`,
    });
    const disclosure = {
      businessName: dispatch.businessName,
      callerName,
      leadName: target.name ?? undefined,
    };
    try {
      let externalId: string;
      if (elevenAgentId) {
        const { outboundCall } = await import("./lib/elevenAgents");
        const to = toE164(target.phone);
        if (!to) throw new Error(`Unusable phone number ${target.phone}`);
        externalId = await outboundCall({
          agentId: elevenAgentId,
          phoneNumberId: dispatch.elevenPhoneNumberId!,
          toNumber: to,
          prompt: task,
          firstMessage: outboundDisclosure(disclosure),
        });
      } else {
        externalId = await sendCall({
          phoneNumber: target.phone,
          task,
          disclosure,
          voice: blandVoice,
          backgroundTrack: dispatch.backgroundTrack ?? undefined,
          webhookUrl,
          metadata: { convexCallId: target.callId },
          maxDurationMin: 5,
        });
      }
      await ctx.runMutation(internal.voice.markCallDispatched, {
        callId: target.callId,
        workspaceId,
        blandCallId: externalId,
        engine: elevenAgentId ? "elevenlabs" : "bland",
      });
      outcome.dispatched++;
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
      outcome.skipped++;
    }
  }

  const moreReady = ready.length > batch.length;
  const notes: string[] = [];
  if (outcome.deferred > 0) {
    notes.push(
      `${outcome.deferred} lead${outcome.deferred === 1 ? "" : "s"} waiting for calling hours (9am–8pm their local time) — they'll be called automatically.`,
    );
  }
  if (outcome.unaffordable > 0 && claim.inFlight === 0 && outcome.dispatched === 0) {
    // Nothing in flight will free credits up — pause until the user tops up.
    await ctx.runMutation(internal.voice.setQualifierCampaignNote, {
      id: campaignId,
      workspaceId,
      statusNote: `Paused — not enough credits for the remaining ${outcome.unaffordable} lead${outcome.unaffordable === 1 ? "" : "s"} (each call reserves up to ${claim.maxCallCost} credits). Top up, then press Start calling.`,
      pause: true,
    });
    return outcome;
  }
  if (outcome.unaffordable > 0) {
    notes.push("Some leads are waiting for credits to free up as live calls finish.");
  }
  await ctx.runMutation(internal.voice.setQualifierCampaignNote, {
    id: campaignId,
    workspaceId,
    statusNote: notes.length ? notes.join(" ") : undefined,
  });
  if (moreReady) {
    await ctx.scheduler.runAfter(0, internal.voiceActions.continueQualifierCampaign, {
      campaignId,
      workspaceId,
    });
  } else if (outcome.deferred > 0 || outcome.unaffordable > 0) {
    await ctx.scheduler.runAfter(
      outcome.unaffordable > 0 ? 10 * 60 * 1000 : CALLING_HOURS_RETRY_MS,
      internal.voiceActions.continueQualifierCampaign,
      { campaignId, workspaceId },
    );
  }
  return outcome;
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
    await assertPlanAction(ctx, "personal", "AI Cold Calling");
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    const { workspaceId } = await ctx.runQuery(internal.voice.getCallerWorkspace, {});
    const dispatch = await ctx.runQuery(internal.voice.getQualifierDispatch, {
      campaignId: args.campaignId,
      workspaceId,
      now: Date.now(),
    });
    if (!dispatch) throw new Error("Campaign not found");
    const callerName = dispatch.callerName ?? "Maya";
    const task = buildQualifierTask({
      prompt: dispatch.prompt,
      callerName,
      businessName: dispatch.businessName,
      context:
        "Context: this is a browser rehearsal — the person you're speaking to is role-playing a lead so they can hear how you handle the call. Treat them exactly like a real lead.",
    });
    const { resolveVoice } = await import("./lib/voicePool");
    const voice = await resolveVoice(ctx, assertBlandVoice(dispatch.voice), {
      workspaceId,
      holdMs: BROWSER_TEST_HOLD_MS,
    });
    const blandCallId = crypto.randomUUID();
    const callRecordId: Id<"calls"> = await ctx.runMutation(
      internal.voice.createQualifierBrowserCall,
      { blandCallId, campaignId: args.campaignId },
    );
    const agentId = await createWebAgent({
      prompt: task,
      voice,
      // Same forced opening line real leads hear.
      firstSentence: outboundDisclosure({
        businessName: dispatch.businessName,
        callerName,
      }),
      backgroundTrack: dispatch.backgroundTrack ?? undefined,
      webhookUrl: blandWebhookUrl({ callRecordId }),
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

// ── ElevenLabs (Studio HD) browser tests ────────────────────────────────

/** A browser test lasts at most this long (agent max duration). */
const ELEVEN_TEST_MAX_SEC = 15 * 60;

/**
 * Spin up a throwaway ElevenLabs agent with exactly the config a real call
 * gets, record the test, and hand the browser a single-use WebRTC token.
 * The agent is deleted when the test is finalized (or by the safety net).
 */
async function startElevenTest(
  ctx: ActionCtx,
  spec: { name: string; prompt: string; firstMessage: string; voice: string | null },
  record: (elevenAgentId: string) => Promise<Id<"calls">>,
): Promise<{ conversationToken: string; callRecordId: Id<"calls"> }> {
  const { elevenConfigured } = await import("./lib/elevenlabs");
  if (!elevenConfigured()) {
    throw new Error("NOT_CONFIGURED: ElevenLabs isn't connected yet (ELEVENLABS_API_KEY).");
  }
  const { workspaceId } = await ctx.runQuery(internal.voice.getCallerWorkspace, {});
  const { resolveVoice } = await import("./lib/voicePool");
  const voiceId = await resolveVoice(ctx, assertElevenVoice(spec.voice), {
    workspaceId,
    holdMs: BROWSER_TEST_HOLD_MS,
  });
  const { createAgent, conversationToken, deleteAgent } = await import("./lib/elevenAgents");
  const agentId = await createAgent({
    name: spec.name,
    prompt: spec.prompt,
    firstMessage: spec.firstMessage,
    voiceId,
    maxDurationSec: ELEVEN_TEST_MAX_SEC,
  });
  try {
    const callRecordId = await record(agentId);
    const token = await conversationToken(agentId);
    // Safety net: finalize (and delete the agent) even if the tab just closes.
    await ctx.scheduler.runAfter(
      ELEVEN_TEST_MAX_SEC * 1000 + 60_000,
      internal.voiceActions.finalizeElevenBrowserCall,
      { callRecordId, attempt: 3 },
    );
    return { conversationToken: token, callRecordId };
  } catch (error) {
    await deleteAgent(agentId);
    throw error;
  }
}

export const startElevenBrowserTest = action({
  args: {
    receptionistId: v.id("receptionists"),
    prompt: v.string(),
    voice: v.string(),
    greeting: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ conversationToken: string; callRecordId: Id<"calls"> }> => {
    await assertPlanAction(ctx, "personal", "AI Receptionist");
    if (!args.prompt.trim()) throw new Error("Write a prompt first");
    const { inboundGreeting } = await import("./lib/bland");
    const workspace = await ctx.runQuery(internal.voice.getCallerWorkspaceName, {});
    return await startElevenTest(
      ctx,
      {
        name: "Receptionist browser test",
        prompt: args.prompt,
        firstMessage: inboundGreeting(args.greeting, workspace.name),
        voice: args.voice,
      },
      (elevenAgentId) =>
        ctx.runMutation(internal.voice.createBrowserCall, {
          receptionistId: args.receptionistId,
          elevenAgentId,
        }),
    );
  },
});

export const startElevenQualifierBrowserTest = action({
  args: { campaignId: v.id("qualifierCampaigns") },
  handler: async (
    ctx,
    args,
  ): Promise<{ conversationToken: string; callRecordId: Id<"calls"> }> => {
    await assertPlanAction(ctx, "personal", "AI Cold Calling");
    const { workspaceId } = await ctx.runQuery(internal.voice.getCallerWorkspace, {});
    const dispatch = await ctx.runQuery(internal.voice.getQualifierDispatch, {
      campaignId: args.campaignId,
      workspaceId,
      now: Date.now(),
    });
    if (!dispatch) throw new Error("Campaign not found");
    const callerName = dispatch.callerName ?? "Maya";
    return await startElevenTest(
      ctx,
      {
        name: "Qualifier browser rehearsal",
        prompt: buildQualifierTask({
          prompt: dispatch.prompt,
          callerName,
          businessName: dispatch.businessName,
          context:
            "Context: this is a browser rehearsal — the person you're speaking to is role-playing a lead so they can hear how you handle the call. Treat them exactly like a real lead.",
        }),
        firstMessage: outboundDisclosure({ businessName: dispatch.businessName, callerName }),
        voice: dispatch.voice,
      },
      (elevenAgentId) =>
        ctx.runMutation(internal.voice.createQualifierBrowserCall, {
          campaignId: args.campaignId,
          elevenAgentId,
        }),
    );
  },
});

/**
 * The browser hung up. It reports the conversation id from the SDK; the
 * transcript and duration are then read from ElevenLabs (never from the
 * client), after checking the conversation belongs to this test's agent.
 */
export const endElevenBrowserTest = action({
  args: { callRecordId: v.id("calls"), conversationId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const test = await ctx.runQuery(internal.voice.getOwnedTestCall, {
      callId: args.callRecordId,
    });
    if (!test || test.engine !== "elevenlabs" || !test.elevenAgentId) {
      throw new Error("Test call not found");
    }
    if (test.status !== "in_progress") return;
    if (args.conversationId) {
      const { getConversation } = await import("./lib/elevenAgents");
      try {
        const c = await getConversation(args.conversationId);
        if (c.agentId === test.elevenAgentId) {
          await ctx.runMutation(internal.voice.attachTestConversation, {
            callId: args.callRecordId,
            conversationId: args.conversationId,
          });
        }
      } catch (error) {
        console.warn("endElevenBrowserTest: conversation lookup failed", error);
      }
    }
    // ElevenLabs finishes processing a few seconds after hang-up.
    await ctx.scheduler.runAfter(5000, internal.voiceActions.finalizeElevenBrowserCall, {
      callRecordId: args.callRecordId,
      attempt: 0,
    });
  },
});

export const finalizeElevenBrowserCall = internalAction({
  args: { callRecordId: v.id("calls"), attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const record = await ctx.runQuery(internal.voice.getCallForAnalysis, {
      callId: args.callRecordId,
    });
    if (!record || record.engine !== "elevenlabs" || !record.elevenAgentId) return;
    const { getConversation, listConversations, deleteAgent } = await import(
      "./lib/elevenAgents"
    );
    const agentId = record.elevenAgentId;
    const retry = async () => {
      if (args.attempt < 5) {
        await ctx.scheduler.runAfter(8000, internal.voiceActions.finalizeElevenBrowserCall, {
          ...args,
          attempt: args.attempt + 1,
        });
        return true;
      }
      return false;
    };
    if (record.status !== "in_progress") {
      await deleteAgent(agentId);
      return;
    }
    try {
      let conversationId = record.blandCallId ?? null;
      if (!conversationId) {
        // The tab closed without reporting — the agent only ever had this session.
        const recent = await listConversations(
          agentId,
          Math.floor(record._creationTime / 1000) - 60,
        );
        conversationId = recent[0]?.conversationId ?? null;
        if (conversationId) {
          await ctx.runMutation(internal.voice.attachTestConversation, {
            callId: args.callRecordId,
            conversationId,
          });
        }
      }
      if (!conversationId) {
        if (await retry()) return;
        await ctx.runMutation(internal.voice.completeCall, {
          callId: args.callRecordId,
          durationSec: 0,
          failed: true,
        });
        await deleteAgent(agentId);
        return;
      }
      const c = await getConversation(conversationId);
      if (c.agentId !== agentId) throw new Error("Conversation belongs to another agent");
      if (!c.finished && (await retry())) return;
      await ctx.runMutation(internal.voice.completeCall, {
        callId: args.callRecordId,
        blandCallId: conversationId,
        durationSec: c.durationSec,
        transcript: c.transcript || undefined,
        failed: !c.transcript && c.durationSec === 0,
      });
      await deleteAgent(agentId);
    } catch (error) {
      console.error("ElevenLabs browser test finalize failed:", error);
      if (await retry()) return;
      await ctx.runMutation(internal.voice.completeCall, {
        callId: args.callRecordId,
        durationSec: 0,
        failed: true,
      });
      await deleteAgent(agentId).catch(() => {});
    }
  },
});

/**
 * Start dialing a qualifier campaign. Requires the TCPA consent attestation
 * on every start; dials only leads inside their calling window, only as many
 * as the balance covers, and never anyone on the do-not-call list.
 */
export const startQualifierCampaign = action({
  args: {
    campaignId: v.id("qualifierCampaigns"),
    /** "Prior express written consent from every contact + DNC-scrubbed." */
    consentAttested: v.boolean(),
    /** Fallback zone for leads whose area code/state doesn't place them. */
    timezone: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    dispatched: number;
    skipped: number;
    deferred: number;
    optedOut: number;
    unaffordable: number;
  }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    await assertPlanAction(ctx, "personal", "AI Cold Calling");
    if (args.consentAttested !== true) {
      throw new Error(
        "Confirm you have prior express written consent from every contact and have scrubbed the list against the National Do-Not-Call Registry.",
      );
    }
    const timezone = args.timezone?.trim();
    if (timezone && !isValidTimezone(timezone)) throw new Error("Pick a valid timezone");

    const { workspaceId } = await ctx.runQuery(internal.voice.getCallerWorkspace, {});
    const preview = await ctx.runQuery(internal.voice.getQualifierDispatch, {
      campaignId: args.campaignId,
      workspaceId,
      now: Date.now(),
    });
    if (!preview) throw new Error("Campaign not found");
    if (preview.pending.length === 0) {
      throw new Error(
        "Nothing left to call — every lead was already dialed or has no phone number.",
      );
    }
    // Check the engine is usable BEFORE flipping the campaign to running.
    if (preview.engine === "elevenlabs") {
      const { elevenConfigured } = await import("./lib/elevenlabs");
      if (!elevenConfigured()) {
        throw new Error("NOT_CONFIGURED: ElevenLabs isn't connected yet (ELEVENLABS_API_KEY).");
      }
      if (!preview.elevenPhoneNumberId) {
        throw new Error(
          "Studio HD calling dials from your own number — buy a Studio HD number on the Receptionist page first.",
        );
      }
      assertElevenVoice(preview.voice);
    } else {
      if (!blandConfigured()) {
        throw new Error("NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).");
      }
      assertBlandVoice(preview.voice);
    }
    await ctx.runMutation(internal.voice.attestAndStartQualifierCampaign, {
      campaignId: args.campaignId,
      timezone: timezone || undefined,
    });
    const outcome = await dispatchQualifierBatch(ctx, args.campaignId, workspaceId);
    if (
      outcome.dispatched === 0 &&
      outcome.deferred === 0 &&
      outcome.unaffordable > 0
    ) {
      // Same format spendCredits uses, so the client opens the top-up prompt.
      throw new Error(
        `INSUFFICIENT_CREDITS: need ${outcome.maxCallCost}, have ${Math.floor(outcome.balance)}`,
      );
    }
    return {
      dispatched: outcome.dispatched,
      skipped: outcome.skipped,
      deferred: outcome.deferred,
      optedOut: outcome.optedOut,
      unaffordable: outcome.unaffordable,
    };
  },
});

/** Scheduled follow-up pass (calling hours opened, credits freed, next batch). */
export const continueQualifierCampaign = internalAction({
  args: {
    campaignId: v.id("qualifierCampaigns"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args): Promise<void> => {
    try {
      await dispatchQualifierBatch(ctx, args.campaignId, args.workspaceId);
    } catch (error) {
      console.error("Qualifier follow-up dispatch failed:", error);
    }
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
      if (state.engine === "elevenlabs") {
        const { getConversation } = await import("./lib/elevenAgents");
        const c = await getConversation(state.blandCallId);
        if (c.finished) {
          await ctx.runMutation(internal.voice.completeCall, {
            callId: args.callId,
            blandCallId: state.blandCallId,
            durationSec: c.durationSec,
            transcript: c.transcript || undefined,
            failed: c.failed && c.durationSec === 0,
          });
          return;
        }
      } else {
        const details = await getCallDetails(state.blandCallId);
        if (details.completed) {
          await ctx.runMutation(internal.voice.completeCall, {
            callId: args.callId,
            durationSec: details.durationSec,
            transcript: details.transcript || undefined,
          });
          return;
        }
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
    // Studio HD receptionists: reconcile the last 2h of each live agent's
    // conversations (reconcile is idempotent, so re-seeing one is free).
    const { elevenConfigured } = await import("./lib/elevenlabs");
    if (elevenConfigured()) {
      const agents = await ctx.runQuery(internal.voice.liveElevenReceptionistAgents, {});
      const { listConversations } = await import("./lib/elevenAgents");
      for (const agentId of agents) {
        try {
          const recent = await listConversations(agentId, Date.now() / 1000 - 2 * 3600);
          for (const c of recent) {
            if (c.status !== "done" && c.status !== "failed") continue;
            await ctx.runAction(internal.voiceActions.reconcileElevenConversation, {
              conversationId: c.conversationId,
            });
          }
        } catch (error) {
          console.error(`Studio HD sweep failed for agent ${agentId}:`, error);
        }
      }
    }
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

/**
 * Push the SAVED receptionist config to its live inbound number. Everything
 * is read from the DB after checking the receptionist and its number belong
 * to the caller's workspace — the client only names which receptionist.
 */
export const syncReceptionist = action({
  args: { receptionistId: v.id("receptionists") },
  handler: async (ctx, args): Promise<void> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    await assertPlanAction(ctx, "personal", "AI Receptionist");
    const config = await ctx.runQuery(internal.voice.getReceptionistSync, {
      receptionistId: args.receptionistId,
    });
    await pushReceptionist(ctx, config);
  },
});

/** Delete an ElevenLabs agent nothing uses any more (receptionist deleted). */
export const deleteElevenAgentInternal = internalAction({
  args: { agentId: v.string() },
  handler: async (_ctx, args): Promise<void> => {
    const { deleteAgent } = await import("./lib/elevenAgents");
    try {
      await deleteAgent(args.agentId);
    } catch (error) {
      console.error(`Couldn't delete ElevenLabs agent ${args.agentId}:`, error);
    }
  },
});

/** Re-push a live receptionist (its pooled voice was reloaded under a new id). */
export const resyncReceptionistInternal = internalAction({
  args: { receptionistId: v.id("receptionists") },
  handler: async (ctx, args): Promise<void> => {
    const config = await ctx.runQuery(internal.voice.getReceptionistSyncById, {
      receptionistId: args.receptionistId,
    });
    if (!config) return;
    try {
      await pushReceptionist(ctx, config);
    } catch (error) {
      console.error(`Receptionist ${args.receptionistId} re-sync failed:`, error);
    }
  },
});

type ReceptionistConfig = {
  receptionistId: Id<"receptionists">;
  workspaceId: Id<"workspaces">;
  name: string;
  engine: "bland" | "elevenlabs";
  elevenAgentId?: string;
  elevenPhoneNumberId?: string;
  phoneNumber: string;
  prompt: string;
  voice: string;
  backgroundTrack?: string;
  greeting?: string;
  businessName: string;
};

/** Pool holds: a browser test runs ≤15 min; a qualifier call ≤5 min. */
const BROWSER_TEST_HOLD_MS = 16 * 60 * 1000;
const CALL_HOLD_MS = 6 * 60 * 1000;

/** Longest inbound call an ElevenLabs receptionist stays on. */
const RECEPTIONIST_MAX_CALL_SEC = 30 * 60;

/**
 * Push the saved receptionist to its line on its engine: Bland's inbound
 * config, or an ElevenLabs agent assigned to the imported Twilio number.
 * Cloned voices resolve through the voice pool (loaded on demand).
 */
async function pushReceptionist(ctx: ActionCtx, config: ReceptionistConfig): Promise<void> {
  const { resolveVoice } = await import("./lib/voicePool");
  if (config.engine === "elevenlabs") {
    const { elevenConfigured } = await import("./lib/elevenlabs");
    if (!elevenConfigured()) {
      throw new Error("NOT_CONFIGURED: ElevenLabs isn't connected yet (ELEVENLABS_API_KEY).");
    }
    if (!config.elevenPhoneNumberId) {
      throw new Error("This number isn't connected to Studio HD calling — buy a Studio HD number.");
    }
    const voiceId = await resolveVoice(ctx, assertElevenVoice(config.voice), {
      workspaceId: config.workspaceId,
    });
    const { upsertAgent, assignAgentToNumber } = await import("./lib/elevenAgents");
    const { inboundGreeting } = await import("./lib/bland");
    const agentId = await upsertAgent(config.elevenAgentId, {
      name: `Receptionist — ${config.name}`,
      prompt: config.prompt,
      firstMessage: inboundGreeting(config.greeting, config.businessName),
      voiceId,
      maxDurationSec: RECEPTIONIST_MAX_CALL_SEC,
    });
    if (agentId !== config.elevenAgentId) {
      await ctx.runMutation(internal.voice.setReceptionistAgent, {
        receptionistId: config.receptionistId,
        elevenAgentId: agentId,
      });
    }
    await assignAgentToNumber(config.elevenPhoneNumberId, agentId);
    return;
  }
  if (!blandConfigured()) {
    throw new Error("NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).");
  }
  await configureInbound({
    phoneNumber: config.phoneNumber,
    prompt: config.prompt,
    voice: await resolveVoice(ctx, assertBlandVoice(config.voice), {
      workspaceId: config.workspaceId,
    }),
    backgroundTrack: config.backgroundTrack,
    firstSentence: config.greeting,
    businessName: config.businessName,
    webhookUrl: blandWebhookUrl(),
  });
}

/** ElevenLabs voice ids are 20-char alphanumerics; Bland names/UUIDs are not. */
const ELEVEN_LIBRARY_ID = /^[A-Za-z0-9]{20}$/;

/** A voice an ElevenLabs agent can speak: a Studio HD clone or library voice. */
function assertElevenVoice(voice: string | null | undefined): string {
  if (voice && (voice.startsWith("elv_") || ELEVEN_LIBRARY_ID.test(voice))) return voice;
  throw new Error("Pick a Studio HD voice for Studio HD calling.");
}

/** A voice Bland can speak: anything but a Studio HD (ElevenLabs) voice. */
function assertBlandVoice(voice: string | null | undefined): string {
  const v = voice || "maya";
  if (v.startsWith("elv_") || ELEVEN_LIBRARY_ID.test(v)) {
    throw new Error("Studio HD voices need Studio HD calling — switch the engine or pick a Standard voice.");
  }
  return v;
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
