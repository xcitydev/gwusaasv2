import { internalAction, type ActionCtx } from "./_generated/server";
import { action } from "./lib/functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  type GhlApp,
  ghlConfigured,
  installUrl,
  exchangeToken,
  mintLocationToken,
  createLocation,
  sendIgMessage,
  getContact,
  sealToken,
  openToken,
} from "./lib/ghl";
import { blandConfigured, ttsWav } from "./lib/bland";
import { renderVoiceNote } from "./lib/audio";
import { isAmbiance, VOICE_NOTE_MAX_CHARS, type Ambiance } from "../lib/ig-dms";
import { assertPlanAction } from "./lib/plan";
import {
  isMetaLocation,
  metaConfigured,
  metaAuthorizeUrl,
  refreshMetaToken,
  sendMetaMessage,
  getMetaProfileName,
} from "./lib/metaIg";

const NOT_CONFIGURED =
  "NOT_CONFIGURED: Instagram DMs aren't switched on yet (GHL keys pending).";

function callbackUrl(): string {
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new Error("CONVEX_SITE_URL missing");
  // ONE callback for both apps ("crm" not "ghl" — their validator rejects
  // ghl references; and their portal makes registering per-app URLs
  // painful). The callback works out which app a code belongs to by trying
  // both credential pairs — a code only exchanges with its own app's keys.
  return `${site}/crm/oauth/callback`;
}

/** Admin-only: the one-time agency install links (one per app). */
export const agencyInstallUrl = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    Record<GhlApp, { url: string | null; installed: boolean; configured: boolean }>
  > => {
    const isAdmin = await ctx.runQuery(internal.voice.callerIsAdmin, {});
    if (!isAdmin) throw new Error("Admin only");
    const result = {} as Record<
      GhlApp,
      { url: string | null; installed: boolean; configured: boolean }
    >;
    for (const app of ["provisioner", "messenger"] as const) {
      const configured = ghlConfigured(app);
      const auth = await ctx.runQuery(internal.igDms.getAgencyAuth, {
        role: app,
      });
      // Each link carries a fresh one-shot state; the callback rejects
      // codes that don't come back with one.
      const state = configured
        ? await ctx.runMutation(internal.igDms.createGhlOauthState, {})
        : null;
      result[app] = {
        configured,
        installed: Boolean(auth),
        url: state ? installUrl(app, callbackUrl(), state) : null,
      };
    }
    return result;
  },
});

/**
 * OAuth callback (from http.ts): code → agency tokens. The code carries no
 * app identity, so try each app's credentials — only the right pair works.
 * Only installs an admin started (agencyInstallUrl's one-shot state) count.
 */
export const completeAgencyInstall = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const validState = await ctx.runMutation(internal.igDms.consumeGhlOauthState, {
      state: args.state,
    });
    if (!validState) {
      throw new Error(
        "This connect link is invalid or expired — start again from the IG DMs page.",
      );
    }
    if (validState.purpose === "own_ghl") {
      // Customer's own GHL: only the messenger app, only a Location-class
      // grant (one sub-account), and it binds to THEIR workspace only.
      const tokens = await exchangeToken({
        app: "messenger",
        grant: "authorization_code",
        codeOrToken: args.code,
        redirectUri: callbackUrl(),
      });
      if (!tokens.locationId) {
        throw new Error(
          "Pick one sub-account (the one your Instagram is connected to), not the whole agency. Start again from the IG DMs page.",
        );
      }
      await ctx.runMutation(internal.igDms.bindOwnGhlLocation, {
        workspaceId: validState.workspaceId,
        ghlLocationId: tokens.locationId,
        locationToken: await sealToken(tokens.access_token),
        locationTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
        locationRefreshToken: await sealToken(tokens.refresh_token),
      });
      // Pull their existing Instagram history (self-chunking, no AI fan-out).
      await ctx.scheduler.runAfter(2000, internal.igDmsActions.syncConversations, {
        ghlLocationId: tokens.locationId,
        deep: true,
      });
      return "Your GHL";
    }
    const errors: string[] = [];
    for (const app of ["messenger", "provisioner"] as const) {
      if (!ghlConfigured(app)) continue;
      try {
        const tokens = await exchangeToken({
          app,
          grant: "authorization_code",
          codeOrToken: args.code,
          redirectUri: callbackUrl(),
        });
        // Location-class grant (messenger installed on one sub-account):
        // the token belongs on that location's igAccounts row, not ghlAuth.
        if (tokens.locationId) {
          const account = await ctx.runQuery(
            internal.igDms.getAccountByLocation,
            { ghlLocationId: tokens.locationId },
          );
          if (account) {
            await ctx.runMutation(internal.igDms.patchAccount, {
              id: account._id,
              locationToken: await sealToken(tokens.access_token),
              locationTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
              locationRefreshToken: await sealToken(tokens.refresh_token),
            });
            return `${app} (location ${tokens.locationId})`;
          }
        }
        if (!tokens.companyId) {
          throw new Error(
            "no companyId in response — was the app installed on the agency (not a location)?",
          );
        }
        await ctx.runMutation(internal.igDms.saveAgencyAuth, {
          role: app,
          companyId: tokens.companyId,
          accessToken: await sealToken(tokens.access_token),
          refreshToken: await sealToken(tokens.refresh_token),
          expiresAt: Date.now() + tokens.expires_in * 1000,
        });
        return app;
      } catch (error) {
        errors.push(
          `${app}: ${error instanceof Error ? error.message : "failed"}`,
        );
      }
    }
    throw new Error(errors.join(" | "));
  },
});

/** Fresh agency token for one app, refreshing when near expiry. */
async function freshAgencyAuth(
  ctx: ActionCtx,
  app: GhlApp,
): Promise<{ companyId: string; accessToken: string }> {
  const auth = await ctx.runQuery(internal.igDms.getAgencyAuth, { role: app });
  if (!auth) {
    throw new Error(
      `The platform's GHL ${app} app isn't connected yet — an admin needs to run the one-time install.`,
    );
  }
  if (auth.expiresAt > Date.now() + 5 * 60 * 1000) {
    return { companyId: auth.companyId, accessToken: await openToken(auth.accessToken) };
  }
  const refreshed = await exchangeToken({
    app,
    grant: "refresh_token",
    codeOrToken: await openToken(auth.refreshToken),
  });
  await ctx.runMutation(internal.igDms.saveAgencyAuth, {
    role: app,
    companyId: refreshed.companyId ?? auth.companyId,
    accessToken: await sealToken(refreshed.access_token),
    // Keep the stored (already sealed, or legacy) value when GHL omits one.
    refreshToken: refreshed.refresh_token
      ? await sealToken(refreshed.refresh_token)
      : auth.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
  });
  return {
    companyId: refreshed.companyId ?? auth.companyId,
    accessToken: refreshed.access_token,
  };
}

/**
 * "Use my own GHL": the link that opens GHL's sub-account picker for our
 * messenger app. The callback binds whatever sub-account they pick.
 */
export const startOwnGhlConnect = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    await assertPlanAction(ctx, "personal", "IG DMs & AI Voice");
    if (!ghlConfigured("messenger")) throw new Error(NOT_CONFIGURED);
    const caller = await ctx.runQuery(internal.igDms.getAccountForCaller, {});
    if (!caller) throw new Error("No workspace");
    if (caller.account && caller.account.source !== "own") {
      throw new Error(
        "This workspace already uses the built-in setup, so there's nothing to connect.",
      );
    }
    const state = await ctx.runMutation(internal.igDms.createOwnGhlOauthState, {});
    return { url: installUrl("messenger", callbackUrl(), state) };
  },
});

/**
 * "Connect Instagram directly": Meta's own Instagram login (no GHL). While
 * the Meta app is unapproved only its Instagram testers can finish it, so
 * the button is admin-only until App Review passes.
 */
export const startMetaIgConnect = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    await assertPlanAction(ctx, "personal", "IG DMs & AI Voice");
    if (!metaConfigured()) throw new Error(NOT_CONFIGURED);
    // Admin-only until Meta approves the app (META_IG_PUBLIC=1 opens it).
    if (process.env.META_IG_PUBLIC !== "1") {
      const isAdmin = await ctx.runQuery(internal.voice.callerIsAdmin, {});
      if (!isAdmin) throw new Error("Connecting Instagram directly isn't available yet.");
    }
    const caller = await ctx.runQuery(internal.igDms.getAccountForCaller, {});
    if (!caller) throw new Error("No workspace");
    // Runs alongside a GHL connection; the inbox splits them into tabs.
    const state = await ctx.runMutation(internal.igDms.createOwnGhlOauthState, {
      purpose: "meta_ig",
    });
    return { url: metaAuthorizeUrl(state) };
  },
});

/** Meta OAuth callback (http.ts): code → 60-day token → bind + webhooks on. */
export const completeMetaIgConnect = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const state = await ctx.runMutation(internal.igDms.consumeGhlOauthState, {
      state: args.state,
    });
    if (!state || state.purpose !== "meta_ig") {
      throw new Error("This connect link is invalid or expired. Start again from the IG DMs page.");
    }
    const { exchangeMetaCode, subscribeMetaWebhooks, metaLocationId } = await import(
      "./lib/metaIg"
    );
    const tokens = await exchangeMetaCode(args.code);
    await subscribeMetaWebhooks(tokens.accessToken);
    const ghlLocationId = metaLocationId(tokens.igAccountId);
    await ctx.runMutation(internal.igDms.bindMetaIgAccount, {
      workspaceId: state.workspaceId,
      ghlLocationId,
      igUsername: tokens.username ?? undefined,
      locationToken: await sealToken(tokens.accessToken),
      locationTokenExpiresAt: Date.now() + tokens.expiresIn * 1000,
    });
    // Bring in the DMs already sitting in the inbox.
    await ctx.scheduler.runAfter(1000, internal.igDmsActions.importMetaHistory, { ghlLocationId });
    return tokens.username ? `@${tokens.username}` : "Instagram";
  },
});

/**
 * Pull a Meta-direct account's recent DMs (up to 250 threads, the last 20
 * messages each — Meta serves no more). History only: no triage fan-out.
 */
export const importMetaHistory = internalAction({
  args: { ghlLocationId: v.string() },
  handler: async (ctx, args): Promise<{ threads: number; messages: number }> => {
    const { listMetaConversations, getMetaConversationMessages, metaConversationKey } =
      await import("./lib/metaIg");
    const account = await ctx.runQuery(internal.igDms.getAccountByLocation, {
      ghlLocationId: args.ghlLocationId,
    });
    if (!account || account.provider !== "meta") throw new Error("Not a direct Instagram account");
    const accountId = args.ghlLocationId.slice("meta:".length);
    const token = await freshLocationToken(ctx, {
      id: account._id,
      ghlLocationId: account.ghlLocationId,
      locationToken: account.locationToken ?? null,
      locationTokenExpiresAt: account.locationTokenExpiresAt ?? 0,
    });
    let threads = 0;
    let messages = 0;
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const { conversations, next } = await listMetaConversations(token, after);
      for (const convo of conversations) {
        const other = (convo.participants?.data ?? []).find(
          (p) => p.id !== accountId && p.username !== account.igUsername,
        );
        if (!other) continue;
        const items = await getMetaConversationMessages(token, convo.id);
        if (items.length === 0) continue;
        const bodyOf = (m: (typeof items)[number]) =>
          m.message || (m.attachments?.data?.length ? "[attachment]" : "");
        const newest = items[0];
        const { conversationId } = await ctx.runMutation(
          internal.igDms.upsertSyncedConversation,
          {
            ghlLocationId: args.ghlLocationId,
            ghlConversationId: metaConversationKey(accountId, other.id),
            ghlContactId: other.id,
            contactName: other.username ? `@${other.username}` : undefined,
            lastMessageAt: newest.created_time ? Date.parse(newest.created_time) : Date.now(),
            lastPreview: bodyOf(newest).slice(0, 120) || undefined,
            lastDirection: newest.from?.id === other.id ? "inbound" : "outbound",
          },
        ).then((r) => r ?? { conversationId: null });
        if (!conversationId) continue;
        threads++;
        for (const m of [...items].reverse()) {
          const body = bodyOf(m);
          if (!body) continue;
          const added = await ctx.runMutation(internal.igDms.insertMessageIfNew, {
            conversationId,
            direction: m.from?.id === other.id ? "inbound" : "outbound",
            body,
            ghlMessageId: m.id,
            sentAt: m.created_time ? Date.parse(m.created_time) : Date.now(),
          });
          if (added) messages++;
        }
      }
      if (!next) break;
      after = next;
    }
    return { threads, messages };
  },
});

/** User switches on IG DMs: provision their GHL location. */
export const enableIgDms = action({
  args: {},
  handler: async (ctx): Promise<{ status: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    await assertPlanAction(ctx, "personal", "IG DMs & AI Voice");
    if (!ghlConfigured("provisioner")) throw new Error(NOT_CONFIGURED);
    const caller = await ctx.runQuery(internal.igDms.getAccountForCaller, {});
    if (!caller) throw new Error("No workspace");
    if (caller.account) return { status: caller.account.status };
    const agency = await freshAgencyAuth(ctx, "provisioner");
    const locationId = await createLocation({
      agencyToken: agency.accessToken,
      companyId: agency.companyId,
      name: `Creatily — ${caller.workspaceName}`.slice(0, 60),
    });
    await ctx.runMutation(internal.igDms.insertAccount, {
      workspaceId: caller.workspaceId,
      ghlLocationId: locationId,
    });
    return { status: "pending_connect" };
  },
});

/** A location token that's valid right now, cached on the account row. */
async function freshLocationToken(
  ctx: ActionCtx,
  account: {
    id: Id<"igAccounts">;
    ghlLocationId: string;
    locationToken: string | null;
    locationTokenExpiresAt: number;
    locationRefreshToken?: string | null;
  },
): Promise<string> {
  if (isMetaLocation(account.ghlLocationId)) {
    return await freshMetaToken(ctx, account);
  }
  // Stored sealed (lib/ghl sealToken); legacy plaintext rows still read.
  if (
    account.locationToken &&
    account.locationTokenExpiresAt > Date.now() + 5 * 60 * 1000
  ) {
    return await openToken(account.locationToken);
  }
  // Preferred: refresh this location's own messenger grant (Location-class
  // OAuth from installing the messenger app on the sub-account).
  if (account.locationRefreshToken) {
    const refreshed = await exchangeToken({
      app: "messenger",
      grant: "refresh_token",
      codeOrToken: await openToken(account.locationRefreshToken),
    });
    await ctx.runMutation(internal.igDms.patchAccount, {
      id: account.id,
      locationToken: await sealToken(refreshed.access_token),
      locationTokenExpiresAt: Date.now() + refreshed.expires_in * 1000,
      locationRefreshToken: refreshed.refresh_token
        ? await sealToken(refreshed.refresh_token)
        : account.locationRefreshToken,
    });
    return refreshed.access_token;
  }
  // Fallback (needs a Company-class messenger grant, e.g. future
  // agency-level install): mint a location token.
  const agency = await freshAgencyAuth(ctx, "messenger");
  const minted = await mintLocationToken({
    agencyToken: agency.accessToken,
    companyId: agency.companyId,
    locationId: account.ghlLocationId,
  });
  await ctx.runMutation(internal.igDms.patchAccount, {
    id: account.id,
    locationToken: await sealToken(minted.access_token),
    locationTokenExpiresAt: Date.now() + minted.expires_in * 1000,
  });
  return minted.access_token;
}

/**
 * Meta long-lived tokens last 60 days and can be extended once they are a
 * day old: refresh when under 7 days remain, and keep using the old one if
 * the refresh is refused while it is still valid.
 */
async function freshMetaToken(
  ctx: ActionCtx,
  account: { id: Id<"igAccounts">; locationToken: string | null; locationTokenExpiresAt: number },
): Promise<string> {
  if (!account.locationToken) {
    throw new Error("Instagram isn't connected. Connect it again from the IG DMs page.");
  }
  const current = await openToken(account.locationToken);
  const now = Date.now();
  // Refresh once under 30 days remain (Meta allows it after the first day).
  if (account.locationTokenExpiresAt > now + 30 * 24 * 3600_000) return current;
  try {
    const refreshed = await refreshMetaToken(current);
    await ctx.runMutation(internal.igDms.patchAccount, {
      id: account.id,
      locationToken: await sealToken(refreshed.accessToken),
      locationTokenExpiresAt: now + refreshed.expiresIn * 1000,
    });
    return refreshed.accessToken;
  } catch {
    if (account.locationTokenExpiresAt > now) return current;
    throw new Error("Your Instagram connection expired. Connect it again from the IG DMs page.");
  }
}

/** One send path for both providers (GHL or Meta direct). */
async function sendDm(
  ctx: ActionCtx,
  account: {
    id: Id<"igAccounts">;
    ghlLocationId: string;
    locationToken: string | null;
    locationTokenExpiresAt: number;
    locationRefreshToken?: string | null;
  },
  contactId: string,
  content: { text?: string; audioUrl?: string; byHuman?: boolean },
): Promise<{ messageId?: string }> {
  const token = await freshLocationToken(ctx, account);
  if (isMetaLocation(account.ghlLocationId)) {
    return await sendMetaMessage({
      token,
      recipientId: contactId,
      text: content.text,
      audioUrl: content.audioUrl,
      // A person typed it: Meta allows up to 7 days (Human Agent) vs 24 h.
      humanAgent: content.byHuman,
    });
  }
  if (content.audioUrl) {
    // GHL accepts the audio, then fails it: "Only images are accepted on
    // instagram". Refuse before anything is charged or recorded.
    throw new Error(
      "Voice notes can't be sent through this connection. Connect Instagram directly to send them.",
    );
  }
  if (!content.audioUrl) {
    return await sendIgMessage({ locationToken: token, contactId, message: content.text });
  }
  try {
    return await sendIgMessage({ locationToken: token, contactId, attachments: [content.audioUrl] });
  } catch (error) {
    // Some GHL versions insist on a body even for attachment sends.
    if (!(error instanceof Error && /^GHL 4\d\d/.test(error.message))) throw error;
    return await sendIgMessage({
      locationToken: token,
      contactId,
      message: "🎙",
      attachments: [content.audioUrl],
    });
  }
}

/** Send a reply into an IG conversation. */
export const sendReply = action({
  args: { conversationId: v.id("igConversations"), text: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await assertPlanAction(ctx, "personal", "IG DMs & AI Voice");
    const text = args.text.trim();
    if (!text) throw new Error("Write a message first");
    const data = await ctx.runQuery(internal.igDms.getConversationForReply, {
      conversationId: args.conversationId,
    });
    if (!data) throw new Error("Conversation not found");
    if (!isMetaLocation(data.account.ghlLocationId) && !ghlConfigured("messenger")) {
      throw new Error(NOT_CONFIGURED);
    }
    const result = await sendDm(ctx, data.account, data.conversation.ghlContactId, {
      text,
      byHuman: true,
    });
    await ctx.runMutation(internal.igDms.recordOutbound, {
      conversationId: args.conversationId,
      body: text,
      ghlMessageId: result.messageId,
      sentBy: "human",
      senderId: data.userId,
    });
  },
});

/** Autopilot send — no user identity (scheduled from triage). */
export const sendSystemReply = internalAction({
  args: {
    conversationId: v.id("igConversations"),
    text: v.string(),
    // The text carries the first-message AI disclosure (igAi.runAutopilot).
    markAiDisclosed: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<void> => {
    const text = args.text.trim();
    if (!text) return;
    const data = await ctx.runQuery(internal.igDms.getConversationSystem, {
      conversationId: args.conversationId,
    });
    if (!data) return;
    if (!isMetaLocation(data.account.ghlLocationId) && !ghlConfigured("messenger")) return;
    const result = await sendDm(ctx, data.account, data.conversation.ghlContactId, { text });
    await ctx.runMutation(internal.igDms.recordOutbound, {
      conversationId: args.conversationId,
      body: text,
      ghlMessageId: result.messageId,
      sentBy: "ai",
      markAiDisclosed: args.markAiDisclosed,
    });
  },
});

type VoiceNoteInput = { text: string; voiceId: string; ambiance: Ambiance };

function validateVoiceNoteInput(args: {
  text: string;
  voiceId: string;
  ambiance: string;
}): VoiceNoteInput {
  if (!ghlConfigured("messenger")) throw new Error(NOT_CONFIGURED);
  const text = args.text.trim();
  if (!text) throw new Error("Write what the note should say first");
  if (text.length > VOICE_NOTE_MAX_CHARS) {
    throw new Error(
      `Keep voice notes under ${VOICE_NOTE_MAX_CHARS} characters (about a minute)`,
    );
  }
  if (!args.voiceId) throw new Error("Pick a voice first");
  if (!isAmbiance(args.ambiance)) throw new Error("Unknown ambiance");
  return { text, voiceId: args.voiceId, ambiance: args.ambiance };
}

/**
 * Our own ".wav"/".mp3" route rather than the raw storage URL — GHL/Meta
 * key attachment type detection off the extension. Null = file is gone.
 */
async function voiceNoteUrl(
  ctx: ActionCtx,
  storageId: Id<"_storage">,
): Promise<string | null> {
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new Error("CONVEX_SITE_URL missing");
  const blob = await ctx.storage.get(storageId);
  if (!blob) return null;
  const ext = blob.type.includes("mpeg") ? "mp3" : "wav";
  return `${site}/crm/audio/${storageId}.${ext}`;
}

/**
 * TTS on whichever engine owns the voice (the caller's ElevenLabs clones →
 * ElevenLabs, everything else → Bland) → ambiance bed mixed under the
 * speech when the audio is WAV → Convex storage. ElevenLabs only returns
 * mixable PCM on its Pro tier; below that the note is a clean MP3.
 */
/** Whether the voice is one of the caller's ElevenLabs clones. */
async function isElevenVoice(ctx: ActionCtx, voiceId: string): Promise<boolean> {
  const clones = await ctx.runQuery(internal.voice.listWorkspaceClones, {});
  return clones.find((c) => c.voiceId === voiceId)?.provider === "elevenlabs";
}

async function renderAndStoreVoiceNote(
  ctx: ActionCtx,
  input: VoiceNoteInput,
): Promise<Id<"_storage">> {
  const isEleven = await isElevenVoice(ctx, input.voiceId);
  const { pooledProvider, withPooledVoice } = await import("./lib/voicePool");
  // Cloned voices only for the workspace that made them.
  const scope = pooledProvider(input.voiceId)
    ? { workspaceId: (await ctx.runQuery(internal.voice.getCallerWorkspace, {})).workspaceId }
    : undefined;
  let speech: Uint8Array;
  let mime: "audio/wav" | "audio/mpeg" = "audio/wav";
  if (isEleven) {
    const { elevenConfigured, ttsForVoiceNote } = await import("./lib/elevenlabs");
    if (!elevenConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: ElevenLabs isn't connected yet (ELEVENLABS_API_KEY).",
      );
    }
    ({ bytes: speech, mime } = await withPooledVoice(
      ctx,
      input.voiceId,
      (remote) => ttsForVoiceNote(remote, input.text),
      scope,
    ));
  } else {
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    speech = await withPooledVoice(
      ctx,
      input.voiceId,
      (remote) => ttsWav(remote, input.text),
      scope,
    );
  }
  const rendered =
    mime === "audio/wav" ? await renderVoiceNote(speech, input.ambiance) : speech;
  const storageId = await ctx.storage.store(
    new Blob(
      [
        rendered.buffer.slice(
          rendered.byteOffset,
          rendered.byteOffset + rendered.byteLength,
        ) as ArrayBuffer,
      ],
      { type: mime },
    ),
  );
  // Registered to the caller's workspace: /crm/audio serves only these, and
  // a send may only reuse its own workspace's preview.
  await ctx.runMutation(internal.igDms.registerVoiceNote, { storageId });
  return storageId;
}

/**
 * Hear a voice note before it goes out. Billed like a send; the send then
 * reuses this rendering (pass its storageId) instead of paying twice.
 */
export const previewVoiceNote = action({
  args: { text: v.string(), voiceId: v.string(), ambiance: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ storageId: Id<"_storage">; audioUrl: string; credits: number }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const input = validateVoiceNoteInput(args);
    const { credits } = await ctx.runMutation(internal.igDms.chargeVoiceNote, {
      chars: input.text.length,
      elevenLabs: await isElevenVoice(ctx, input.voiceId),
    });
    try {
      const storageId = await renderAndStoreVoiceNote(ctx, input);
      const audioUrl = await voiceNoteUrl(ctx, storageId);
      if (!audioUrl) throw new Error("The rendered audio went missing");
      return { storageId, audioUrl, credits };
    } catch (error) {
      await ctx.runMutation(internal.igDms.refundVoiceNote, { credits });
      throw error;
    }
  },
});

/**
 * Voice note in the user's cloned voice, sent to Instagram as an audio
 * attachment. Renders fresh unless a preview's rendering is handed in.
 * Credits are refunded if anything fails before the DM is out.
 */
export const sendVoiceNote = action({
  args: {
    conversationId: v.id("igConversations"),
    text: v.string(),
    voiceId: v.string(),
    ambiance: v.string(),
    renderedStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args): Promise<{ credits: number }> => {
    await assertPlanAction(ctx, "personal", "IG DMs & AI Voice");
    const input = validateVoiceNoteInput(args);
    const data = await ctx.runQuery(internal.igDms.getConversationForReply, {
      conversationId: args.conversationId,
    });
    if (!data) throw new Error("Conversation not found");
    if (!isMetaLocation(data.account.ghlLocationId)) {
      throw new Error(
        "Voice notes can't be sent through this connection. Connect Instagram directly to send them.",
      );
    }

    let credits = 0;
    let audioStorageId: Id<"_storage">;
    if (args.renderedStorageId) {
      // Already rendered (and billed) by the preview — the caller's own.
      const owns = await ctx.runQuery(internal.igDms.callerOwnsVoiceNote, {
        storageId: args.renderedStorageId,
      });
      if (!owns) throw new Error("That preview is gone — render it again");
      audioStorageId = args.renderedStorageId;
    } else {
      ({ credits } = await ctx.runMutation(internal.igDms.chargeVoiceNote, {
        chars: input.text.length,
        elevenLabs: await isElevenVoice(ctx, input.voiceId),
      }));
      try {
        audioStorageId = await renderAndStoreVoiceNote(ctx, input);
      } catch (error) {
        await ctx.runMutation(internal.igDms.refundVoiceNote, { credits });
        throw error;
      }
    }

    try {
      const audioUrl = await voiceNoteUrl(ctx, audioStorageId);
      if (!audioUrl) throw new Error("That preview is gone — render it again");
      const result = await sendDm(ctx, data.account, data.conversation.ghlContactId, {
        audioUrl,
        byHuman: true,
      });
      await ctx.runMutation(internal.igDms.recordOutbound, {
        conversationId: args.conversationId,
        body: input.text,
        ghlMessageId: result.messageId,
        sentBy: "human",
        senderId: data.userId,
        kind: "voice",
        audioStorageId,
      });
      // Remember the picks so the composer opens on them next time.
      await ctx.runMutation(internal.igDms.patchAccount, {
        id: data.account.id,
        voiceId: input.voiceId,
        ambiance: input.ambiance,
      });
      return { credits };
    } catch (error) {
      if (credits > 0) {
        await ctx.runMutation(internal.igDms.refundVoiceNote, { credits });
      }
      throw error;
    }
  },
});

/** GHL timestamps arrive as epoch millis OR ISO strings — normalize. */
function toMillis(value: unknown): number {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * Pull conversations/messages for one location via the API — the
 * webhook-miss safety net. A normal sweep checks the newest page and only
 * fetches threads with activity we haven't stored; `deep` pages through
 * the location's whole IG history (first connect / manual backfill).
 */
export const syncConversations = internalAction({
  args: {
    ghlLocationId: v.string(),
    deep: v.optional(v.boolean()),
    // Deep continuation cursor (last row's lastMessageDate).
    startAfterDate: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    pages: number;
    conversationsSeen: number;
    threadsFetched: number;
    messagesAdded: number;
    continues: boolean;
  }> => {
    const { searchConversations, getConversationMessages } = await import(
      "./lib/ghl"
    );
    const account = await ctx.runQuery(internal.igDms.getAccountByLocation, {
      ghlLocationId: args.ghlLocationId,
    });
    if (!account) throw new Error("No igAccounts row for that location");
    const token = await freshLocationToken(ctx, {
      id: account._id,
      ghlLocationId: account.ghlLocationId,
      locationToken: account.locationToken ?? null,
      locationTokenExpiresAt: account.locationTokenExpiresAt ?? 0,
      locationRefreshToken: account.locationRefreshToken ?? null,
    });
    const pageSize = args.deep ? 100 : 30;
    // Deep runs chunk themselves: a few pages per invocation, then the
    // action reschedules itself with the cursor — a multi-thousand-thread
    // history does not fit inside one 10-minute action.
    const maxPages = args.deep ? 4 : 1;
    const messageLimit = args.deep ? 100 : 30;
    let startAfterDate = args.startAfterDate;
    let nextCursor: number | undefined;
    let pages = 0;
    let conversationsSeen = 0;
    let threadsFetched = 0;
    let messagesAdded = 0;
    for (let page = 0; page < maxPages; page++) {
      const conversations = await searchConversations({
        locationToken: token,
        locationId: args.ghlLocationId,
        limit: pageSize,
        startAfterDate,
      });
      pages++;
      if (conversations.length === 0) break;
      for (const convo of conversations) {
        // IG only (the search is filtered, this is belt-and-braces). GHL's
        // `type` field shadows the useful `lastMessageType`, so check both.
        const type = `${convo.type ?? ""} ${convo.lastMessageType ?? ""}`;
        if (!/instagram/i.test(type)) continue;
        const ghlConversationId = String(convo.id ?? "");
        const ghlContactId = String(convo.contactId ?? "");
        if (!ghlConversationId || !ghlContactId) continue;
        conversationsSeen++;
        const direction = String(convo.lastMessageDirection ?? "");
        const upsert = await ctx.runMutation(
          internal.igDms.upsertSyncedConversation,
          {
            ghlLocationId: args.ghlLocationId,
            ghlConversationId,
            ghlContactId,
            contactName:
              typeof convo.fullName === "string" && convo.fullName
                ? convo.fullName
                : typeof convo.contactName === "string" && convo.contactName
                  ? convo.contactName
                  : undefined,
            lastMessageAt: toMillis(convo.lastMessageDate),
            lastPreview:
              typeof convo.lastMessageBody === "string"
                ? convo.lastMessageBody
                : undefined,
            lastDirection: /outbound/i.test(direction)
              ? "outbound"
              : /inbound/i.test(direction)
                ? "inbound"
                : undefined,
          },
        );
        if (!upsert?.stale) continue;
        threadsFetched++;
        const messages = await getConversationMessages({
          locationToken: token,
          conversationId: ghlConversationId,
          limit: messageLimit,
        });
        let inboundAdded = 0;
        for (const message of messages) {
          const body = typeof message.body === "string" ? message.body : "";
          const id = String(message.id ?? "");
          if (!body || !id) continue;
          const messageDirection =
            String(message.direction ?? "") === "outbound"
              ? ("outbound" as const)
              : ("inbound" as const);
          const added = await ctx.runMutation(
            internal.igDms.insertMessageIfNew,
            {
              conversationId: upsert.conversationId,
              direction: messageDirection,
              body,
              ghlMessageId: id,
              sentAt: toMillis(message.dateAdded ?? message.dateUpdated),
            },
          );
          if (added) {
            messagesAdded++;
            if (messageDirection === "inbound") inboundAdded++;
          }
        }
        await ctx.runMutation(internal.igDms.settleConversation, {
          conversationId: upsert.conversationId,
        });
        // One triage per thread per sweep (autopilot's freshness guard
        // keeps backfilled history from ever being auto-answered).
        // A deep backfill is history, not new activity: no triage fan-out
        // (run igAi:triageBacklog deliberately, staggered, if wanted).
        if (inboundAdded > 0 && !args.deep) {
          await ctx.scheduler.runAfter(0, internal.igAi.triageConversation, {
            conversationId: upsert.conversationId,
          });
        }
      }
      const last = conversations[conversations.length - 1];
      const cursor = Number(last?.lastMessageDate);
      if (
        conversations.length < pageSize ||
        !Number.isFinite(cursor) ||
        cursor <= 0 ||
        cursor === startAfterDate
      ) {
        break;
      }
      startAfterDate = cursor;
      if (page === maxPages - 1) nextCursor = cursor;
    }
    if (args.deep && nextCursor !== undefined) {
      await ctx.scheduler.runAfter(
        1000,
        internal.igDmsActions.syncConversations,
        {
          ghlLocationId: args.ghlLocationId,
          deep: true,
          startAfterDate: nextCursor,
        },
      );
    }
    return {
      pages,
      conversationsSeen,
      threadsFetched,
      messagesAdded,
      continues: nextCursor !== undefined,
    };
  },
});

/** "Sync now" from the inbox — a quick sweep of the caller's location. */
export const syncMyAccount = action({
  args: { channel: v.optional(v.union(v.literal("ghl"), v.literal("meta"))) },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadsFetched: number; messagesAdded: number }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const caller = await ctx.runQuery(internal.igDms.getAccountForCaller, {});
    // Direct-to-Meta: re-pull recent history (live DMs come by webhook).
    if (caller?.metaAccount && (args.channel === "meta" || !caller.account)) {
      const r = await ctx.runAction(internal.igDmsActions.importMetaHistory, {
        ghlLocationId: caller.metaAccount.ghlLocationId,
      });
      return { threadsFetched: r.threads, messagesAdded: r.messages };
    }
    if (!caller?.account) throw new Error("Enable Instagram DMs first");
    if (!ghlConfigured("messenger")) throw new Error(NOT_CONFIGURED);
    const result = await ctx.runAction(
      internal.igDmsActions.syncConversations,
      { ghlLocationId: caller.account.ghlLocationId },
    );
    return {
      threadsFetched: result.threadsFetched,
      messagesAdded: result.messagesAdded,
    };
  },
});

/**
 * "Connect Instagram" from inside GWU: returns the Meta OAuth URL for a
 * popup — the client never sees GHL. Creates the location's hidden
 * connector user on first use.
 */
export const startIgConnect = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    await assertPlanAction(ctx, "personal", "IG DMs & AI Voice");
    if (!ghlConfigured("messenger")) throw new Error(NOT_CONFIGURED);
    const caller = await ctx.runQuery(internal.igDms.getAccountForCaller, {});
    if (!caller?.account) throw new Error("Enable Instagram DMs first");
    const account = caller.account;
    if (account.source === "own") {
      throw new Error(
        "Your workspace is linked to your own CRM account. Connect Instagram there (Settings → Integrations), then press Sync here.",
      );
    }
    if (account.provider === "meta") {
      throw new Error("Instagram is already connected directly.");
    }
    const token = await freshLocationToken(ctx, {
      id: account._id,
      ghlLocationId: account.ghlLocationId,
      locationToken: account.locationToken ?? null,
      locationTokenExpiresAt: account.locationTokenExpiresAt ?? 0,
      locationRefreshToken: account.locationRefreshToken ?? null,
    });
    let userId = account.ghlUserId;
    if (!userId) {
      const { createLocationUser } = await import("./lib/ghl");
      const agency = await freshAgencyAuth(ctx, "provisioner");
      userId = await createLocationUser({
        token,
        companyId: agency.companyId,
        locationId: account.ghlLocationId,
        email: `connector+${account.ghlLocationId.toLowerCase()}@gwuagency.com`,
      });
      await ctx.runMutation(internal.igDms.patchAccount, {
        id: account._id,
        ghlUserId: userId,
      });
    }
    const { startSocialOauth } = await import("./lib/ghl");
    const start = await startSocialOauth({
      locationToken: token,
      locationId: account.ghlLocationId,
      userId,
      platform: "instagram",
    });
    if (start.redirectUrl) return { url: start.redirectUrl };
    throw new Error(
      `GHL OAuth start ${start.status}: ${start.body || "no redirect returned"}`,
    );
  },
});

/** After the Meta popup closes: attach the IG account(s) and go live. */
export const finishIgConnect = action({
  args: { oauthAccountId: v.string() },
  handler: async (ctx, args): Promise<{ igUsername: string | null }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    const caller = await ctx.runQuery(internal.igDms.getAccountForCaller, {});
    if (!caller?.account) throw new Error("Enable Instagram DMs first");
    const account = caller.account;
    if (account.source === "own") {
      throw new Error(
        "Your workspace is linked to your own CRM account. Connect Instagram there (Settings → Integrations), then press Sync here.",
      );
    }
    if (account.provider === "meta") {
      throw new Error("Instagram is already connected directly.");
    }
    const token = await freshLocationToken(ctx, {
      id: account._id,
      ghlLocationId: account.ghlLocationId,
      locationToken: account.locationToken ?? null,
      locationTokenExpiresAt: account.locationTokenExpiresAt ?? 0,
      locationRefreshToken: account.locationRefreshToken ?? null,
    });
    const { listIgAccountsAfterOauth, attachIgAccount } = await import(
      "./lib/ghl"
    );
    const accounts = await listIgAccountsAfterOauth({
      locationToken: token,
      locationId: account.ghlLocationId,
      accountId: args.oauthAccountId,
    });
    if (accounts.length === 0) {
      throw new Error(
        "Meta returned no Instagram professional accounts — is the Instagram a Business/Creator account linked to a Facebook Page?",
      );
    }
    for (const igAccount of accounts) {
      await attachIgAccount({
        locationToken: token,
        locationId: account.ghlLocationId,
        accountId: args.oauthAccountId,
        account: igAccount,
      });
    }
    const igUsername = accounts[0]?.name ?? null;
    await ctx.runMutation(internal.igDms.patchAccount, {
      id: account._id,
      status: "connected",
      igUsername: igUsername ?? undefined,
    });
    await ctx.scheduler.runAfter(
      5000,
      internal.igDmsActions.syncConversations,
      { ghlLocationId: account.ghlLocationId, deep: true },
    );
    return { igUsername };
  },
});

/** Daily: extend every direct-Instagram token before it can lapse. */
export const refreshMetaTokens = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const accounts = await ctx.runQuery(internal.igDms.listMetaAccounts, {});
    for (const account of accounts) {
      try {
        await freshMetaToken(ctx, account);
      } catch (error) {
        console.error("Meta token refresh failed for", account.ghlLocationId, error);
      }
    }
  },
});

/** Cron sweep: sync every connected location (webhook-independent). */
export const syncAllIgAccounts = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    if (!ghlConfigured("messenger")) return;
    const locationIds = await ctx.runQuery(internal.igDms.listAllAccounts, {});
    for (const ghlLocationId of locationIds) {
      try {
        await ctx.runAction(internal.igDmsActions.syncConversations, {
          ghlLocationId,
        });
      } catch (error) {
        console.error("IG sync failed for", ghlLocationId, error);
      }
    }
  },
});

/** Backfill the contact's display name after their first message. */
export const resolveContactName = internalAction({
  args: {
    conversationId: v.id("igConversations"),
  },
  handler: async (ctx, args): Promise<void> => {
    const data = await ctx.runQuery(internal.igDms.getConversationSystem, {
      conversationId: args.conversationId,
    });
    if (!data || data.conversation.contactName) return;
    try {
      const token = await freshLocationToken(ctx, data.account);
      const name = isMetaLocation(data.account.ghlLocationId)
        ? await getMetaProfileName(token, data.conversation.ghlContactId)
        : (
            await getContact({
              locationToken: token,
              contactId: data.conversation.ghlContactId,
            })
          ).name;
      if (name) {
        await ctx.runMutation(internal.igDms.setContactName, {
          conversationId: args.conversationId,
          name,
        });
      }
    } catch (error) {
      console.error("IG contact name lookup failed:", error);
    }
  },
});
