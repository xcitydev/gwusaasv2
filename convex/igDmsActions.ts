import { action, internalAction, type ActionCtx } from "./_generated/server";
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
} from "./lib/ghl";
import { blandConfigured, ttsWav } from "./lib/bland";
import { renderVoiceNote } from "./lib/audio";
import { isAmbiance, VOICE_NOTE_MAX_CHARS, type Ambiance } from "../lib/ig-dms";

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
      result[app] = {
        configured,
        installed: Boolean(auth),
        url: configured ? installUrl(app, callbackUrl()) : null,
      };
    }
    return result;
  },
});

/**
 * OAuth callback (from http.ts): code → agency tokens. The code carries no
 * app identity, so try each app's credentials — only the right pair works.
 */
export const completeAgencyInstall = internalAction({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<string> => {
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
              locationToken: tokens.access_token,
              locationTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
              locationRefreshToken: tokens.refresh_token,
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
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
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
    return { companyId: auth.companyId, accessToken: auth.accessToken };
  }
  const refreshed = await exchangeToken({
    app,
    grant: "refresh_token",
    codeOrToken: auth.refreshToken,
  });
  await ctx.runMutation(internal.igDms.saveAgencyAuth, {
    role: app,
    companyId: refreshed.companyId ?? auth.companyId,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
  });
  return {
    companyId: refreshed.companyId ?? auth.companyId,
    accessToken: refreshed.access_token,
  };
}

/** User switches on IG DMs: provision their GHL location. */
export const enableIgDms = action({
  args: {},
  handler: async (ctx): Promise<{ status: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (!ghlConfigured("provisioner")) throw new Error(NOT_CONFIGURED);
    const caller = await ctx.runQuery(internal.igDms.getAccountForCaller, {});
    if (!caller) throw new Error("No workspace");
    if (caller.account) return { status: caller.account.status };
    const agency = await freshAgencyAuth(ctx, "provisioner");
    const locationId = await createLocation({
      agencyToken: agency.accessToken,
      companyId: agency.companyId,
      name: `GWU — ${caller.workspaceName}`.slice(0, 60),
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
  if (
    account.locationToken &&
    account.locationTokenExpiresAt > Date.now() + 5 * 60 * 1000
  ) {
    return account.locationToken;
  }
  // Preferred: refresh this location's own messenger grant (Location-class
  // OAuth from installing the messenger app on the sub-account).
  if (account.locationRefreshToken) {
    const refreshed = await exchangeToken({
      app: "messenger",
      grant: "refresh_token",
      codeOrToken: account.locationRefreshToken,
    });
    await ctx.runMutation(internal.igDms.patchAccount, {
      id: account.id,
      locationToken: refreshed.access_token,
      locationTokenExpiresAt: Date.now() + refreshed.expires_in * 1000,
      locationRefreshToken:
        refreshed.refresh_token ?? account.locationRefreshToken,
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
    locationToken: minted.access_token,
    locationTokenExpiresAt: Date.now() + minted.expires_in * 1000,
  });
  return minted.access_token;
}

/** Send a reply into an IG conversation. */
export const sendReply = action({
  args: { conversationId: v.id("igConversations"), text: v.string() },
  handler: async (ctx, args): Promise<void> => {
    if (!ghlConfigured("messenger")) throw new Error(NOT_CONFIGURED);
    const text = args.text.trim();
    if (!text) throw new Error("Write a message first");
    const data = await ctx.runQuery(internal.igDms.getConversationForReply, {
      conversationId: args.conversationId,
    });
    if (!data) throw new Error("Conversation not found");
    const token = await freshLocationToken(ctx, data.account);
    const result = await sendIgMessage({
      locationToken: token,
      contactId: data.conversation.ghlContactId,
      message: text,
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
  args: { conversationId: v.id("igConversations"), text: v.string() },
  handler: async (ctx, args): Promise<void> => {
    if (!ghlConfigured("messenger")) return;
    const text = args.text.trim();
    if (!text) return;
    const data = await ctx.runQuery(internal.igDms.getConversationSystem, {
      conversationId: args.conversationId,
    });
    if (!data) return;
    const token = await freshLocationToken(ctx, data.account);
    const result = await sendIgMessage({
      locationToken: token,
      contactId: data.conversation.ghlContactId,
      message: text,
    });
    await ctx.runMutation(internal.igDms.recordOutbound, {
      conversationId: args.conversationId,
      body: text,
      ghlMessageId: result.messageId,
      sentBy: "ai",
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
async function renderAndStoreVoiceNote(
  ctx: ActionCtx,
  input: VoiceNoteInput,
): Promise<Id<"_storage">> {
  const clones = await ctx.runQuery(internal.voice.listWorkspaceClones, {});
  const isEleven =
    clones.find((c) => c.voiceId === input.voiceId)?.provider === "elevenlabs";
  let speech: Uint8Array;
  let mime: "audio/wav" | "audio/mpeg" = "audio/wav";
  if (isEleven) {
    const { elevenConfigured, ttsForVoiceNote } = await import("./lib/elevenlabs");
    if (!elevenConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: ElevenLabs isn't connected yet (ELEVENLABS_API_KEY).",
      );
    }
    ({ bytes: speech, mime } = await ttsForVoiceNote(input.voiceId, input.text));
  } else {
    if (!blandConfigured()) {
      throw new Error(
        "NOT_CONFIGURED: The voice engine isn't connected yet (BLAND_API_KEY).",
      );
    }
    speech = await ttsWav(input.voiceId, input.text);
  }
  const rendered =
    mime === "audio/wav" ? await renderVoiceNote(speech, input.ambiance) : speech;
  return await ctx.storage.store(
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
    const input = validateVoiceNoteInput(args);
    const data = await ctx.runQuery(internal.igDms.getConversationForReply, {
      conversationId: args.conversationId,
    });
    if (!data) throw new Error("Conversation not found");

    let credits = 0;
    let audioStorageId: Id<"_storage">;
    if (args.renderedStorageId) {
      // Already rendered (and billed) by the preview.
      audioStorageId = args.renderedStorageId;
    } else {
      ({ credits } = await ctx.runMutation(internal.igDms.chargeVoiceNote, {
        chars: input.text.length,
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
      const token = await freshLocationToken(ctx, data.account);
      let result: { messageId?: string };
      try {
        result = await sendIgMessage({
          locationToken: token,
          contactId: data.conversation.ghlContactId,
          attachments: [audioUrl],
        });
      } catch (error) {
        // Some GHL versions insist on a body even for attachment sends.
        if (!(error instanceof Error && /^GHL 4\d\d/.test(error.message))) {
          throw error;
        }
        result = await sendIgMessage({
          locationToken: token,
          contactId: data.conversation.ghlContactId,
          message: "🎙",
          attachments: [audioUrl],
        });
      }
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
  args: {},
  handler: async (
    ctx,
  ): Promise<{ threadsFetched: number; messagesAdded: number }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (!ghlConfigured("messenger")) throw new Error(NOT_CONFIGURED);
    const caller = await ctx.runQuery(internal.igDms.getAccountForCaller, {});
    if (!caller?.account) throw new Error("Enable Instagram DMs first");
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
    if (!ghlConfigured("messenger")) throw new Error(NOT_CONFIGURED);
    const caller = await ctx.runQuery(internal.igDms.getAccountForCaller, {});
    if (!caller?.account) throw new Error("Enable Instagram DMs first");
    const account = caller.account;
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

/** TEMP verification: list locations + mint a location token end to end. */
export const debugGhlChain = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, unknown>> => {
    const { listLocations } = await import("./lib/ghl");
    const provisioner = await freshAgencyAuth(ctx, "provisioner");
    const messenger = await freshAgencyAuth(ctx, "messenger");
    const locations = await listLocations({
      agencyToken: provisioner.accessToken,
      companyId: provisioner.companyId,
    });
    const target = locations.find((l) => /gwu agency/i.test(l.name));
    let mint: string = "skipped — no 'gwu agency' location found";
    if (target) {
      try {
        const minted = await mintLocationToken({
          agencyToken: messenger.accessToken,
          companyId: messenger.companyId,
          locationId: target.id,
        });
        mint = `ok — location token minted (expires ${Math.round(minted.expires_in / 3600)}h)`;
      } catch (error) {
        mint = `FAILED: ${error instanceof Error ? error.message : "?"}`;
      }
    }
    return { locations, targetLocation: target ?? null, locationTokenMint: mint };
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
      const { name } = await getContact({
        locationToken: token,
        contactId: data.conversation.ghlContactId,
      });
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
