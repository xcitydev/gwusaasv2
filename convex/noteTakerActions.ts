import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import {
  recallConfigured,
  RecallError,
  botBehavior,
  createBot,
  getBot,
  leaveCall,
  deleteScheduledBot,
  deleteBotMedia,
  downloadTranscript,
  createCalendar,
  getCalendar,
  deleteCalendar,
  listCalendarEvents,
  getCalendarEvent,
  scheduleEventBot,
  removeEventBot,
  describeEvent,
  type RecallBot,
  type RecallCalendarEvent,
} from "./lib/recall";
import {
  toSegments,
  participantsOf,
  computeAnalytics,
  chunkSegments,
} from "./lib/transcript";
import {
  detectPlatform,
  ACTIVE_STATUSES,
  type MeetingStatus,
} from "../lib/note-taker";

/**
 * AI Note Taker — bot lifecycle. Send a bot (now / at a time / from a
 * calendar or Cal.com booking), follow it through the call, and when Recall
 * is done: store the transcript, bill the minutes, hand off to the notes
 * pass. Webhooks speed things up; a self-rescheduling poll (and a 10-min
 * cron) means nothing depends on them.
 */

const NOT_CONFIGURED =
  "NOT_CONFIGURED: The note taker isn't switched on yet (RECALL_API_KEY pending).";

const POLL_MS = 60_000;
/** ~12 h of minute polls — far past any real meeting. */
const MAX_POLLS = 720;

type DispatchInfo = NonNullable<
  Awaited<ReturnType<typeof loadDispatchInfo>>
>;

async function loadDispatchInfo(ctx: ActionCtx, meetingId: Id<"meetings">) {
  return await ctx.runQuery(internal.noteTaker.getDispatchInfo, { meetingId });
}

function isLive(status: MeetingStatus): boolean {
  return status === "scheduled" || ACTIVE_STATUSES.includes(status);
}

function behaviorFor(info: DispatchInfo): Record<string, unknown> {
  const { meeting, settings } = info;
  return botBehavior({
    botName: settings.botName,
    metadata: {
      meetingId: meeting._id,
      workspaceId: meeting.workspaceId,
    },
    announce: settings.announce
      ? `${settings.botName} is recording and taking notes for this meeting. The host can remove me at any time.`
      : null,
    retentionHours: settings.retentionDays * 24,
    maxRecordingSec: info.maxRecordingSec,
  });
}

/** Recall's fatal sub_codes, in words a user can act on. */
function friendlyFailure(subCode?: string | null, message?: string | null): string {
  const known: Record<string, string> = {
    meeting_not_found: "That meeting link doesn't exist (or has ended).",
    meeting_link_invalid: "That meeting link isn't valid.",
    meeting_link_expired: "That meeting link has expired.",
    meeting_not_started: "The meeting never started.",
    meeting_requires_registration:
      "This meeting requires registration — the bot can't sign up for it.",
    meeting_requires_sign_in:
      "This meeting only admits signed-in accounts — the bot couldn't get in.",
    meeting_password_incorrect: "The meeting password in the link is wrong.",
    meeting_locked: "The meeting was locked, so the bot couldn't join.",
    meeting_full: "The meeting was full.",
    bot_kicked_from_waiting_room: "The host declined the bot in the waiting room.",
    bot_kicked_from_call: "The host removed the bot from the call.",
    timeout_exceeded_waiting_room:
      "Nobody admitted the bot from the waiting room in time.",
    timeout_exceeded_noone_joined: "Nobody joined the meeting.",
    timeout_exceeded_recording_permission_denied:
      "The host declined the recording request.",
  };
  if (subCode && known[subCode]) return known[subCode];
  return (message || subCode || "The bot couldn't join the meeting.").slice(0, 200);
}

// ── Sending bots ────────────────────────────────────────────────────────

/** Create the Recall bot for a meeting row; 507 (ad-hoc pool empty) retries. */
async function dispatch(
  ctx: ActionCtx,
  meetingId: Id<"meetings">,
  opts: { rethrow: boolean },
): Promise<void> {
  const info = await loadDispatchInfo(ctx, meetingId);
  if (!info) return;
  const { meeting } = info;
  try {
    const bot = await createBot({
      meetingUrl: meeting.meetingUrl,
      joinAt: meeting.scheduledFor,
      behavior: behaviorFor(info),
    });
    await ctx.runMutation(internal.noteTaker.patchMeeting, {
      meetingId,
      recallBotId: bot.id,
      clearStatusDetail: true,
    });
    const firstPollIn = meeting.scheduledFor
      ? Math.max(POLL_MS, meeting.scheduledFor - Date.now() + POLL_MS)
      : POLL_MS;
    await ctx.scheduler.runAfter(firstPollIn, internal.noteTakerActions.pollMeeting, {
      meetingId,
      expectedStart: meeting.scheduledFor,
    });
  } catch (error) {
    const attempts = (meeting.dispatchAttempts ?? 0) + 1;
    if (error instanceof RecallError && error.status === 507 && attempts < 8) {
      await ctx.runMutation(internal.noteTaker.patchMeeting, {
        meetingId,
        dispatchAttempts: attempts,
        statusDetail: "Waiting for a free bot…",
      });
      await ctx.scheduler.runAfter(30_000, internal.noteTakerActions.retryDispatch, {
        meetingId,
      });
      return;
    }
    await ctx.runMutation(internal.noteTaker.patchMeeting, {
      meetingId,
      status: "failed",
      statusDetail:
        error instanceof Error ? error.message.slice(0, 200) : "Couldn't send the bot",
    });
    if (opts.rethrow) throw error;
  }
}

export const retryDispatch = internalAction({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<void> => {
    await dispatch(ctx, args.meetingId, { rethrow: false });
  },
});

/** "Record a meeting": paste a link, join now or at a set time. */
export const sendBot = action({
  args: {
    meetingUrl: v.string(),
    title: v.optional(v.string()),
    joinAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ meetingId: Id<"meetings"> }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (!recallConfigured()) throw new Error(NOT_CONFIGURED);
    const meetingUrl = args.meetingUrl.trim();
    const platform = detectPlatform(meetingUrl);
    if (!platform) {
      throw new Error(
        "That doesn't look like a Zoom, Google Meet, Teams, Webex or GoTo link",
      );
    }
    let scheduledFor: number | undefined;
    if (args.joinAt) {
      if (args.joinAt < Date.now() - 60_000) throw new Error("That time is in the past");
      // Anything within a couple of minutes is just "now".
      if (args.joinAt > Date.now() + 2 * 60_000) scheduledFor = args.joinAt;
    }
    const meetingId = await ctx.runMutation(internal.noteTaker.createMeeting, {
      meetingUrl,
      title: args.title,
      platform,
      scheduledFor,
    });
    await dispatch(ctx, meetingId, { rethrow: true });
    return { meetingId };
  },
});

// ── Following a bot ─────────────────────────────────────────────────────

/** Read the bot's true state from Recall and mirror it onto the meeting. */
async function refresh(
  ctx: ActionCtx,
  meeting: Doc<"meetings">,
): Promise<{ status: MeetingStatus; finalized: boolean }> {
  if (!meeting.recallBotId || !isLive(meeting.status)) {
    return { status: meeting.status, finalized: Boolean(meeting.finalizedAt) };
  }
  if (meeting.finalizedAt) return { status: meeting.status, finalized: true };
  let bot: RecallBot;
  try {
    bot = await getBot(meeting.recallBotId);
  } catch (error) {
    if (error instanceof RecallError && error.status === 404) {
      await ctx.runMutation(internal.noteTaker.patchMeeting, {
        meetingId: meeting._id,
        status: "cancelled",
        statusDetail: "The bot no longer exists",
      });
      return { status: "cancelled", finalized: false };
    }
    throw error;
  }
  const changes = bot.status_changes ?? [];
  const latest = changes[changes.length - 1];
  if (!latest) return { status: meeting.status, finalized: false };

  if (latest.code === "done" || latest.code === "analysis_done") {
    return await finalize(ctx, meeting, bot);
  }
  if (latest.code === "fatal") {
    await ctx.runMutation(internal.noteTaker.patchMeeting, {
      meetingId: meeting._id,
      status: "failed",
      statusDetail: friendlyFailure(latest.sub_code, latest.message),
    });
    return { status: "failed", finalized: false };
  }
  if (latest.code === "media_expired") {
    await ctx.runMutation(internal.noteTaker.patchMeeting, {
      meetingId: meeting._id,
      status: "failed",
      statusDetail: "The recording expired before it could be processed",
      mediaDeleted: true,
    });
    return { status: "failed", finalized: false };
  }

  let status: MeetingStatus = meeting.status;
  let detail: string | undefined;
  switch (latest.code) {
    case "ready":
      status =
        meeting.scheduledFor && meeting.scheduledFor > Date.now()
          ? "scheduled"
          : "joining";
      break;
    case "joining_call":
      status = "joining";
      break;
    case "in_waiting_room":
      status = "waiting_room";
      detail = "Admit the bot from the waiting room";
      break;
    case "in_call_not_recording":
    case "recording_permission_allowed":
      status = "joining";
      detail = "In the call — starting the recording";
      break;
    case "recording_permission_denied":
      status = "joining";
      detail = "The host declined the recording request";
      break;
    case "in_call_recording":
      status = "recording";
      break;
    case "call_ended":
      status = "processing";
      detail = "Call ended — transcribing";
      break;
  }
  const recordingSince = changes.find((c) => c.code === "in_call_recording")?.created_at;
  const startedAt = recordingSince ? Date.parse(recordingSince) : undefined;
  if (
    status !== meeting.status ||
    detail !== meeting.statusDetail ||
    (startedAt && !meeting.startedAt)
  ) {
    await ctx.runMutation(internal.noteTaker.patchMeeting, {
      meetingId: meeting._id,
      status,
      ...(detail ? { statusDetail: detail } : { clearStatusDetail: true }),
      ...(startedAt && !meeting.startedAt && { startedAt }),
    });
  }
  return { status, finalized: false };
}

/** Recall says done: transcript → segments → store + bill → notes pass. */
async function finalize(
  ctx: ActionCtx,
  meeting: Doc<"meetings">,
  bot: RecallBot,
): Promise<{ status: MeetingStatus; finalized: boolean }> {
  const recording = bot.recordings?.[0];
  if (!recording) {
    await ctx.runMutation(internal.noteTaker.patchMeeting, {
      meetingId: meeting._id,
      status: "failed",
      statusDetail:
        "The bot never recorded — it wasn't admitted, or nobody joined.",
    });
    return { status: "failed", finalized: false };
  }
  const endedAt = recording.completed_at
    ? Date.parse(recording.completed_at)
    : Date.now();
  const transcript = recording.media_shortcuts?.transcript;
  const transcriptState = transcript?.status?.code ?? null;
  const downloadUrl = transcript?.data?.download_url ?? null;
  const transcriptReady = Boolean(downloadUrl) && (!transcriptState || transcriptState === "done");
  if (!transcriptReady) {
    // Accuracy-mode transcripts land minutes after the call. Keep waiting —
    // unless it failed outright or has clearly stalled, then close out
    // without one so the meeting still ends and bills.
    const stalled = Date.now() - endedAt > 45 * 60_000;
    if (transcriptState !== "failed" && !stalled) {
      if (meeting.status !== "processing") {
        await ctx.runMutation(internal.noteTaker.patchMeeting, {
          meetingId: meeting._id,
          status: "processing",
          statusDetail: "Call ended — transcribing",
        });
      }
      return { status: "processing", finalized: false };
    }
  }
  const entries = transcriptReady ? await downloadTranscript(downloadUrl!) : [];
  const segments = toSegments(entries);
  const startedAt = recording.started_at
    ? Date.parse(recording.started_at)
    : undefined;
  const lastSegment = segments[segments.length - 1];
  const durationSec = startedAt
    ? Math.max(0, Math.round((endedAt - startedAt) / 1000))
    : lastSegment
      ? Math.ceil(lastSegment.end)
      : 0;
  const platformTitle = recording.media_shortcuts?.meeting_metadata?.data?.title;
  const result = await ctx.runMutation(internal.noteTaker.storeRecording, {
    meetingId: meeting._id,
    startedAt,
    endedAt,
    durationSec,
    platformTitle: platformTitle ?? undefined,
    attendees: participantsOf(entries),
    analytics: computeAnalytics(segments),
    parts: chunkSegments(segments),
  });
  if (result.stored) {
    await ctx.scheduler.runAfter(0, internal.noteTakerAi.generateNotes, {
      meetingId: meeting._id,
    });
  }
  return { status: "processing", finalized: true };
}

/** Minute-by-minute follower; reschedules itself while the bot is live. */
export const pollMeeting = internalAction({
  args: { meetingId: v.id("meetings"), expectedStart: v.optional(v.number()) },
  handler: async (ctx, args): Promise<void> => {
    const meeting = await ctx.runQuery(internal.noteTaker.getMeetingInternal, {
      meetingId: args.meetingId,
    });
    if (!meeting || !isLive(meeting.status) || meeting.finalizedAt) return;
    // Rescheduled since this chain started — the newer chain owns it.
    if ((meeting.scheduledFor ?? undefined) !== args.expectedStart) return;
    let outcome = { status: meeting.status as MeetingStatus, finalized: false };
    try {
      outcome = await refresh(ctx, meeting);
    } catch (error) {
      console.error("Note taker poll failed:", error);
    }
    if (outcome.finalized || !isLive(outcome.status)) return;
    const polls = (meeting.pollCount ?? 0) + 1;
    if (polls > MAX_POLLS) {
      await ctx.runMutation(internal.noteTaker.patchMeeting, {
        meetingId: args.meetingId,
        status: "failed",
        statusDetail: "Timed out waiting for the meeting to finish",
      });
      return;
    }
    await ctx.runMutation(internal.noteTaker.patchMeeting, {
      meetingId: args.meetingId,
      pollCount: polls,
    });
    await ctx.scheduler.runAfter(POLL_MS, internal.noteTakerActions.pollMeeting, args);
  },
});

/** Webhook poke: some bot changed state — go read the truth. */
export const onBotEvent = internalAction({
  args: { recallBotId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    if (!recallConfigured()) return;
    const meeting = await ctx.runQuery(internal.noteTaker.getByBot, {
      recallBotId: args.recallBotId,
    });
    if (!meeting) return;
    try {
      await refresh(ctx, meeting);
    } catch (error) {
      console.error("Note taker webhook refresh failed:", error);
    }
  },
});

/** Stop button: pull the bot out (notes still get written for what it heard). */
export const stopMeeting = action({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<void> => {
    const meeting = await ctx.runQuery(internal.noteTaker.getOwnMeeting, {
      meetingId: args.meetingId,
    });
    if (!meeting) throw new Error("Meeting not found");
    if (!isLive(meeting.status)) return;
    if (meeting.status === "scheduled" || !meeting.recallBotId) {
      if (meeting.recallBotId) await cancelBot(meeting.recallBotId, meeting.recallEventId);
      await ctx.runMutation(internal.noteTaker.patchMeeting, {
        meetingId: args.meetingId,
        status: "cancelled",
        statusDetail: "Skipped by you",
      });
      return;
    }
    await leaveCall(meeting.recallBotId);
    await ctx.runMutation(internal.noteTaker.patchMeeting, {
      meetingId: args.meetingId,
      statusDetail: "Leaving the call…",
    });
  },
});

/** Best-effort cancel of a bot that hasn't joined yet. */
async function cancelBot(botId: string, recallEventId?: string): Promise<void> {
  try {
    if (recallEventId) await removeEventBot(recallEventId);
    else await deleteScheduledBot(botId);
  } catch {
    // Inside 10 minutes of join time Recall wants leave_call instead.
    try {
      await leaveCall(botId);
    } catch (error) {
      console.error("Note taker: couldn't cancel bot", botId, error);
    }
  }
}

/** A deleted meeting: get its bot out, then erase what Recall stored. */
export const retireBot = internalAction({
  args: {
    botId: v.string(),
    recallEventId: v.optional(v.string()),
    wasLive: v.boolean(),
    wasScheduled: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    if (!recallConfigured()) return;
    if (args.wasScheduled) {
      await cancelBot(args.botId, args.recallEventId);
      return;
    }
    if (args.wasLive) {
      try {
        await leaveCall(args.botId);
      } catch (error) {
        console.error("Note taker: leave_call failed", error);
      }
    }
    // Media can't be deleted while the bot is still in progress.
    await ctx.scheduler.runAfter(
      args.wasLive ? 15 * 60_000 : 0,
      internal.noteTakerActions.purgeMedia,
      { botId: args.botId, attempt: 0 },
    );
  },
});

export const purgeMedia = internalAction({
  args: { botId: v.string(), attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    try {
      await deleteBotMedia(args.botId);
    } catch (error) {
      const retryable =
        error instanceof RecallError && (error.status === 400 || error.status === 409);
      if (retryable && args.attempt < 5) {
        await ctx.scheduler.runAfter(20 * 60_000, internal.noteTakerActions.purgeMedia, {
          botId: args.botId,
          attempt: args.attempt + 1,
        });
      } else {
        console.error("Note taker: media purge failed", args.botId, error);
      }
    }
  },
});

/** A fresh (short-lived) video URL for the player. */
export const getRecordingUrl = action({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const meeting = await ctx.runQuery(internal.noteTaker.getOwnMeeting, {
      meetingId: args.meetingId,
    });
    if (!meeting) throw new Error("Meeting not found");
    if (!meeting.recallBotId || !recallConfigured()) return { url: null };
    try {
      const bot = await getBot(meeting.recallBotId);
      const url =
        bot.recordings?.[0]?.media_shortcuts?.video_mixed?.data?.download_url ?? null;
      return { url };
    } catch {
      return { url: null };
    }
  },
});

/** Cron: rescue stranded meetings, re-sync calendars. */
export const sweep = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    if (!recallConfigured()) return;
    const stranded = await ctx.runQuery(internal.noteTaker.listStranded, {});
    for (const meetingId of stranded) {
      const meeting = await ctx.runQuery(internal.noteTaker.getMeetingInternal, {
        meetingId,
      });
      if (!meeting) continue;
      try {
        await refresh(ctx, meeting);
      } catch (error) {
        console.error("Note taker sweep refresh failed:", meetingId, error);
      }
    }
    const calendars = await ctx.runQuery(internal.noteTaker.listAllCalendars, {});
    for (const calendarDocId of calendars) {
      try {
        await ctx.runAction(internal.noteTakerActions.syncCalendar, { calendarDocId });
      } catch (error) {
        console.error("Note taker calendar sync failed:", calendarDocId, error);
      }
    }
  },
});

// ── Calendar connect (Google / Microsoft → Recall Calendar V2) ───────────

const OAUTH = {
  google: {
    platform: "google_calendar" as const,
    clientId: () => process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope:
      "https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/userinfo.email",
    // offline + consent = Google actually returns a refresh token.
    extra: { access_type: "offline", prompt: "consent" },
  },
  microsoft: {
    platform: "microsoft_outlook" as const,
    clientId: () => process.env.MS_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.MS_OAUTH_CLIENT_SECRET,
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access openid email https://graph.microsoft.com/Calendars.Read",
    extra: { response_mode: "query", prompt: "select_account" },
  },
};

const providerValidator = v.union(v.literal("google"), v.literal("microsoft"));

function oauthRedirectUri(provider: "google" | "microsoft"): string {
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new Error("CONVEX_SITE_URL missing");
  return `${site}/notes/oauth/${provider}/callback`;
}

/** Where to send the user to grant read access to their calendar. */
export const calendarConnectUrl = action({
  args: { provider: providerValidator },
  handler: async (ctx, args): Promise<{ url: string }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (!recallConfigured()) throw new Error(NOT_CONFIGURED);
    const config = OAUTH[args.provider];
    const clientId = config.clientId();
    if (!clientId || !config.clientSecret()) {
      throw new Error(
        `NOT_CONFIGURED: ${args.provider === "google" ? "Google" : "Outlook"} calendar connect isn't set up on the platform yet.`,
      );
    }
    const state = await ctx.runMutation(internal.noteTaker.createOauthState, {
      platform: config.platform,
    });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: oauthRedirectUri(args.provider),
      response_type: "code",
      scope: config.scope,
      state,
      ...config.extra,
    });
    return { url: `${config.authUrl}?${params}` };
  },
});

/** OAuth callback: code → refresh token → Recall calendar → first sync. */
export const completeCalendarConnect = internalAction({
  args: { provider: providerValidator, code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const owner = await ctx.runMutation(internal.noteTaker.consumeOauthState, {
      state: args.state,
    });
    const config = OAUTH[args.provider];
    if (!owner || owner.platform !== config.platform) {
      throw new Error("This link expired — start the connection again.");
    }
    const clientId = config.clientId();
    const clientSecret = config.clientSecret();
    if (!clientId || !clientSecret) throw new Error("Calendar connect isn't configured.");
    const res = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: args.code,
        redirect_uri: oauthRedirectUri(args.provider),
        grant_type: "authorization_code",
        ...(args.provider === "microsoft" && { scope: config.scope }),
      }).toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Token exchange ${res.status}: ${text.slice(0, 200)}`);
    const tokens = JSON.parse(text) as { refresh_token?: string };
    if (!tokens.refresh_token) {
      throw new Error(
        "No refresh token came back — remove this app's access in your account's security settings, then connect again.",
      );
    }
    const calendar = await createCalendar({
      platform: config.platform,
      oauthClientId: clientId,
      oauthClientSecret: clientSecret,
      oauthRefreshToken: tokens.refresh_token,
    });
    const calendarDocId = await ctx.runMutation(internal.noteTaker.insertCalendar, {
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      platform: config.platform,
      recallCalendarId: calendar.id,
      email: calendar.platform_email ?? undefined,
    });
    // Recall needs a moment to pull events after a fresh connect.
    await ctx.scheduler.runAfter(20_000, internal.noteTakerActions.syncCalendar, {
      calendarDocId,
    });
  },
});

type CalendarData = NonNullable<
  Awaited<ReturnType<typeof loadCalendar>>
>;

async function loadCalendar(ctx: ActionCtx, calendarDocId: Id<"noteTakerCalendars">) {
  return await ctx.runQuery(internal.noteTaker.getCalendarDoc, { calendarDocId });
}

/**
 * Make our state match one calendar event: schedule its bot (auto-join, or
 * `force` from the Record toggle), move it when the event moved, cancel it
 * when the event lost its link or was deleted.
 */
async function reconcileEvent(
  ctx: ActionCtx,
  data: CalendarData,
  event: RecallCalendarEvent,
  force: boolean,
): Promise<void> {
  const { calendar, settings } = data;
  const dedupKey = `cal:${event.id}`;
  const existing = await ctx.runQuery(internal.noteTaker.getByDedup, {
    workspaceId: calendar.workspaceId,
    dedupKey,
  });
  const meetingUrl = event.meeting_url?.trim();
  if (event.is_deleted || !meetingUrl) {
    if (existing?.status === "scheduled") {
      try {
        await removeEventBot(event.id);
      } catch {
        // Recall already drops bots for deleted events.
      }
      await ctx.runMutation(internal.noteTaker.patchMeeting, {
        meetingId: existing._id,
        status: "cancelled",
        statusDetail: "Removed from the calendar",
      });
    }
    return;
  }
  const startMs = Date.parse(event.start_time);
  if (!Number.isFinite(startMs) || startMs < Date.now() - 5 * 60_000) return;
  // Already ran (or running) — nothing to schedule.
  if (existing && existing.status !== "scheduled" && existing.status !== "cancelled") {
    return;
  }
  // A skip sticks until the user presses Record again.
  if (existing?.status === "cancelled" && !force) return;
  if (!force && settings.autoJoin !== "all" && existing?.status !== "scheduled") return;
  if (
    existing?.status === "scheduled" &&
    existing.recallBotId &&
    existing.scheduledFor === startMs
  ) {
    return;
  }

  const { title, attendees } = describeEvent(event);
  const meetingId = await ctx.runMutation(internal.noteTaker.upsertSystemMeeting, {
    workspaceId: calendar.workspaceId,
    userId: calendar.userId,
    dedupKey,
    source: "calendar",
    meetingUrl,
    platform: detectPlatform(meetingUrl) ?? undefined,
    title: title ?? undefined,
    scheduledFor: startMs,
    attendees,
    calendarId: calendar._id,
    recallEventId: event.id,
  });
  const info = await loadDispatchInfo(ctx, meetingId);
  if (!info) return;
  if (!info.canAfford) {
    await ctx.runMutation(internal.noteTaker.patchMeeting, {
      meetingId,
      status: "cancelled",
      statusDetail: "Not enough credits — top up, then press Record",
    });
    return;
  }
  if (existing?.recallBotId) {
    try {
      await removeEventBot(event.id);
    } catch {
      // Nothing scheduled any more — fine.
    }
  }
  const deduplicationKey = `${event.start_time}-${meetingUrl}`;
  const updated = await scheduleEventBot({
    eventId: event.id,
    deduplicationKey,
    behavior: behaviorFor(info),
  });
  const botId =
    updated.bots?.find((b) => b.deduplication_key === deduplicationKey)?.bot_id ??
    updated.bots?.[0]?.bot_id;
  await ctx.runMutation(internal.noteTaker.patchMeeting, {
    meetingId,
    status: "scheduled",
    clearStatusDetail: true,
    ...(botId && { recallBotId: botId }),
  });
  await ctx.scheduler.runAfter(
    Math.max(POLL_MS, startMs - Date.now() + POLL_MS),
    internal.noteTakerActions.pollMeeting,
    { meetingId, expectedStart: startMs },
  );
}

/** Pull changed events for one calendar and reconcile each. */
export const syncCalendar = internalAction({
  args: {
    calendarDocId: v.id("noteTakerCalendars"),
    since: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    if (!recallConfigured()) return;
    const data = await loadCalendar(ctx, args.calendarDocId);
    if (!data || data.calendar.status !== "connected") return;
    const cursor = new Date().toISOString();
    const events = await listCalendarEvents({
      calendarId: data.calendar.recallCalendarId,
      updatedSince: args.since ?? data.calendar.lastSyncedTs,
      startsAfter: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    for (const event of events) {
      try {
        await reconcileEvent(ctx, data, event, false);
      } catch (error) {
        console.error("Note taker: event reconcile failed", event.id, error);
      }
    }
    await ctx.runMutation(internal.noteTaker.patchCalendar, {
      calendarDocId: args.calendarDocId,
      lastSyncedTs: cursor,
    });
  },
});

/** Webhook poke for a calendar: connection changed, or events did. */
export const onCalendarEvent = internalAction({
  args: {
    recallCalendarId: v.string(),
    event: v.string(),
    lastUpdatedTs: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    if (!recallConfigured()) return;
    const calendar = await ctx.runQuery(internal.noteTaker.getCalendarByRecallId, {
      recallCalendarId: args.recallCalendarId,
    });
    if (!calendar) return;
    if (args.event === "calendar.update") {
      const remote = await getCalendar(args.recallCalendarId);
      const connected = remote.status !== "disconnected";
      if (connected !== (calendar.status === "connected")) {
        await ctx.runMutation(internal.noteTaker.patchCalendar, {
          calendarDocId: calendar._id,
          status: connected ? "connected" : "disconnected",
        });
      }
      return;
    }
    await ctx.runAction(internal.noteTakerActions.syncCalendar, {
      calendarDocId: calendar._id,
      since: args.lastUpdatedTs,
    });
  },
});

/** Next two weeks across the caller's calendars, with each event's record state. */
export const listUpcomingEvents = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    {
      calendarDocId: Id<"noteTakerCalendars">;
      eventId: string;
      title: string;
      startsAt: number;
      meetingUrl: string | null;
      platform: string | null;
      attendeeCount: number;
      recording: boolean;
    }[]
  > => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not signed in");
    if (!recallConfigured()) return [];
    const calendars = await ctx.runQuery(internal.noteTaker.listOwnCalendars, {});
    const horizon = Date.now() + 14 * 24 * 60 * 60_000;
    const upcoming = [];
    for (const calendar of calendars) {
      if (calendar.status !== "connected") continue;
      const events = await listCalendarEvents({
        calendarId: calendar.recallCalendarId,
        startsAfter: new Date().toISOString(),
        maxPages: 2,
      });
      for (const event of events) {
        const startsAt = Date.parse(event.start_time);
        if (event.is_deleted || !Number.isFinite(startsAt) || startsAt > horizon) continue;
        const { title, attendees } = describeEvent(event);
        const meetingUrl = event.meeting_url?.trim() || null;
        upcoming.push({
          calendarDocId: calendar._id,
          eventId: event.id,
          title: title ?? "Untitled event",
          startsAt,
          meetingUrl,
          platform: meetingUrl ? detectPlatform(meetingUrl) : null,
          attendeeCount: attendees.length,
          recording: (event.bots ?? []).length > 0,
        });
      }
    }
    return upcoming.sort((a, b) => a.startsAt - b.startsAt).slice(0, 40);
  },
});

/** The Record toggle on one upcoming calendar event. */
export const setEventRecording = action({
  args: {
    calendarDocId: v.id("noteTakerCalendars"),
    eventId: v.string(),
    record: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    if (!recallConfigured()) throw new Error(NOT_CONFIGURED);
    const calendars = await ctx.runQuery(internal.noteTaker.listOwnCalendars, {});
    if (!calendars.some((c) => c._id === args.calendarDocId)) {
      throw new Error("Calendar not found");
    }
    const data = await loadCalendar(ctx, args.calendarDocId);
    if (!data) throw new Error("Calendar not found");
    const event = await getCalendarEvent(args.eventId);
    if (args.record) {
      if (!event.meeting_url) throw new Error("That event has no meeting link");
      await reconcileEvent(ctx, data, event, true);
      return;
    }
    try {
      await removeEventBot(args.eventId);
    } catch {
      // No bot was scheduled.
    }
    const existing = await ctx.runQuery(internal.noteTaker.getByDedup, {
      workspaceId: data.calendar.workspaceId,
      dedupKey: `cal:${args.eventId}`,
    });
    if (existing?.status === "scheduled") {
      await ctx.runMutation(internal.noteTaker.patchMeeting, {
        meetingId: existing._id,
        status: "cancelled",
        statusDetail: "Skipped by you",
      });
    }
  },
});

export const disconnectCalendar = action({
  args: { calendarDocId: v.id("noteTakerCalendars") },
  handler: async (ctx, args): Promise<void> => {
    const calendars = await ctx.runQuery(internal.noteTaker.listOwnCalendars, {});
    const calendar = calendars.find((c) => c._id === args.calendarDocId);
    if (!calendar) throw new Error("Calendar not found");
    if (recallConfigured()) {
      try {
        // Recall drops the bots it scheduled for this calendar's events.
        await deleteCalendar(calendar.recallCalendarId);
      } catch (error) {
        if (!(error instanceof RecallError && error.status === 404)) throw error;
      }
    }
    await ctx.runMutation(internal.noteTaker.removeCalendar, {
      calendarDocId: args.calendarDocId,
    });
  },
});

// ── Cal.com bookings ────────────────────────────────────────────────────

/** First supported meeting link anywhere Cal.com puts one. */
function calcomMeetingUrl(payload: Record<string, unknown>): string | null {
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  const videoCallData = (payload.videoCallData ?? {}) as Record<string, unknown>;
  const candidates = [metadata.videoCallUrl, videoCallData.url, payload.location];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && detectPlatform(candidate)) {
      return candidate.trim();
    }
  }
  return null;
}

export const onCalcomBooking = internalAction({
  args: { token: v.string(), body: v.any() },
  handler: async (ctx, args): Promise<void> => {
    if (!recallConfigured()) return;
    const owner = await ctx.runQuery(internal.noteTaker.getWorkspaceByCalcomToken, {
      token: args.token,
    });
    if (!owner) return;
    const body = (args.body ?? {}) as Record<string, unknown>;
    const trigger = String(body.triggerEvent ?? "");
    const payload = (body.payload ?? {}) as Record<string, unknown>;
    const uid = typeof payload.uid === "string" ? payload.uid : "";
    if (!uid) return;

    const cancel = async (bookingUid: string, reason: string) => {
      const existing = await ctx.runQuery(internal.noteTaker.getByDedup, {
        workspaceId: owner.workspaceId,
        dedupKey: `calcom:${bookingUid}`,
      });
      if (existing?.status !== "scheduled") return;
      if (existing.recallBotId) await cancelBot(existing.recallBotId);
      await ctx.runMutation(internal.noteTaker.patchMeeting, {
        meetingId: existing._id,
        status: "cancelled",
        statusDetail: reason,
      });
    };

    if (trigger === "BOOKING_CANCELLED") {
      await cancel(uid, "Booking cancelled");
      return;
    }
    if (trigger !== "BOOKING_CREATED" && trigger !== "BOOKING_RESCHEDULED") return;
    if (typeof payload.rescheduleUid === "string" && payload.rescheduleUid) {
      await cancel(payload.rescheduleUid, "Booking rescheduled");
    }
    const meetingUrl = calcomMeetingUrl(payload);
    const startMs = Date.parse(String(payload.startTime ?? ""));
    if (!meetingUrl || !Number.isFinite(startMs) || startMs < Date.now() - 60_000) return;

    const attendees: { name: string; email?: string }[] = [];
    for (const person of (Array.isArray(payload.attendees) ? payload.attendees : []) as Record<
      string,
      unknown
    >[]) {
      const email = typeof person.email === "string" ? person.email : undefined;
      const name = (typeof person.name === "string" && person.name) || email;
      if (name) attendees.push({ name, ...(email && { email }) });
    }
    const existing = await ctx.runQuery(internal.noteTaker.getByDedup, {
      workspaceId: owner.workspaceId,
      dedupKey: `calcom:${uid}`,
    });
    if (existing?.recallBotId && existing.status === "scheduled") {
      if (existing.scheduledFor === startMs) return;
      await cancelBot(existing.recallBotId);
    }
    const meetingId = await ctx.runMutation(internal.noteTaker.upsertSystemMeeting, {
      workspaceId: owner.workspaceId,
      userId: owner.ownerId,
      dedupKey: `calcom:${uid}`,
      source: "calcom",
      meetingUrl,
      platform: detectPlatform(meetingUrl) ?? undefined,
      title: typeof payload.title === "string" ? payload.title : undefined,
      scheduledFor: startMs,
      attendees,
    });
    const info = await loadDispatchInfo(ctx, meetingId);
    if (!info?.canAfford) {
      await ctx.runMutation(internal.noteTaker.patchMeeting, {
        meetingId,
        status: "cancelled",
        statusDetail: "Not enough credits to record this booking",
      });
      return;
    }
    await dispatch(ctx, meetingId, { rethrow: false });
  },
});
