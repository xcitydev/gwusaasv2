import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { verifyWhopSignature } from "./lib/whop";

const http = httpRouter();

/**
 * Whop payments webhook — the only writer of plan state. Svix wire format:
 * signature over `${webhook-id}.${webhook-timestamp}.${raw body}`, so the
 * body must be read raw BEFORE parsing. Handlers are idempotent (Whop
 * delivers at-least-once and retries for ~3 days); unknown event types are
 * acknowledged so retries don't pile up, but our own failures return 500 so
 * Whop retries them.
 */
http.route({
  path: "/whop-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.WHOP_WEBHOOK_SECRET;
    if (!secret) {
      console.error("WHOP-WEBHOOK: rejected, WHOP_WEBHOOK_SECRET is not set");
      return new Response("not configured", { status: 503 });
    }
    const rawBody = await request.text();
    const ok = await verifyWhopSignature({
      secret,
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signatureHeader: request.headers.get("webhook-signature"),
      rawBody,
    });
    if (!ok) {
      // Logged so a wrong secret in the dashboard is visible, with nothing
      // sensitive: which headers were present and how big the body was.
      console.error(
        "WHOP-WEBHOOK: rejected, invalid signature",
        JSON.stringify({
          hasId: Boolean(request.headers.get("webhook-id")),
          hasTimestamp: Boolean(request.headers.get("webhook-timestamp")),
          hasSignature: Boolean(request.headers.get("webhook-signature")),
          bodyBytes: rawBody.length,
        }),
      );
      return new Response("invalid signature", { status: 401 });
    }

    const event = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      data?: {
        id?: string;
        status?: string;
        substatus?: string;
        billing_reason?: string;
        membership?: { id?: string } | null;
        metadata?: Record<string, unknown> | null;
        usd_total?: number;
      } | null;
    };
    const data = event.data ?? {};

    if (event.type === "payment.succeeded" && data.id) {
      const result = await ctx.runMutation(internal.whop.handlePaymentSucceeded, {
        paymentId: data.id,
        billingReason: data.billing_reason,
        membershipId: data.membership?.id,
        metadata: data.metadata ?? undefined,
        usdTotal: typeof data.usd_total === "number" ? data.usd_total : undefined,
      });
      console.log("WHOP-WEBHOOK:", event.type, data.id, result.handled);
      return new Response("ok", { status: 200 });
    }

    if (event.type?.startsWith("membership.") && data.id) {
      const result = await ctx.runMutation(internal.whop.handleMembershipUpdate, {
        eventId: event.id ?? `${event.type}:${data.id}:${data.status ?? ""}`,
        membershipId: data.id,
        membershipStatus: data.status,
      });
      console.log("WHOP-WEBHOOK:", event.type, data.id, result.handled);
      return new Response("ok", { status: 200 });
    }

    // Refunds: Whop's refund event, or any payment event whose payment has
    // been voided/refunded. Credit packs are clawed back; plans only logged.
    const refundLike =
      event.type === "payment.refunded" ||
      (Boolean(event.type?.startsWith("payment.")) &&
        event.type !== "payment.succeeded" &&
        (data.status === "void" || data.substatus === "refunded"));
    if (refundLike && data.id) {
      const result = await ctx.runMutation(internal.whop.handlePaymentRefunded, {
        eventId: event.id ?? `${event.type}:${data.id}`,
        paymentId: data.id,
        metadata: data.metadata ?? undefined,
        usdTotal: typeof data.usd_total === "number" ? data.usd_total : undefined,
      });
      console.log("WHOP-WEBHOOK:", event.type, data.id, result.handled);
      return new Response("ok", { status: 200 });
    }

    // Disputes and anything else: acknowledge, keep a trace.
    console.log("WHOP-WEBHOOK: ignored", event.type ?? "unknown", event.id ?? "");
    return new Response("ignored", { status: 200 });
  }),
});

/**
 * Bland AI posts here when a call ends. The request must carry the shared
 * secret in its URL (BLAND_WEBHOOK_SECRET, set when the URL is registered),
 * and the body is treated purely as a notification: the call is re-read from
 * Bland's API in voiceActions.reconcileFromWebhook, which bills per-second
 * credits once and stores the transcript. Outbound calls are matched via the
 * metadata.convexCallId we attach when initiating; web sessions via the
 * callRecordId query param; real inbound calls via Bland's call id.
 */
http.route({
  path: "/bland-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    // Bland does not sign webhooks, so the registered URL carries a shared
    // secret. When one is configured, anything without it is dropped.
    const secret = process.env.BLAND_WEBHOOK_SECRET;
    if (secret && !safeEqual(url.searchParams.get("key") ?? "", secret)) {
      return new Response("unauthorized", { status: 401 });
    }
    let payload: { call_id?: unknown; metadata?: { convexCallId?: unknown } };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return new Response("bad json", { status: 400 });
    }
    // The body is only a poke. Nothing in it is trusted: duration, transcript,
    // numbers and outcome are re-read from Bland's API before any credits
    // move (voiceActions.reconcileFromWebhook).
    const blandCallId =
      typeof payload.call_id === "string" && payload.call_id.trim()
        ? payload.call_id.trim()
        : undefined;
    // Outbound calls carry the record id in metadata; web-agent sessions
    // can't set metadata, so their webhook URL carries it as a query param.
    const fromMetadata = payload.metadata?.convexCallId;
    const callRecordId =
      (typeof fromMetadata === "string" ? fromMetadata : undefined) ??
      url.searchParams.get("callRecordId") ??
      undefined;
    if (!blandCallId && !callRecordId) {
      return new Response("ok", { status: 200 });
    }
    await ctx.scheduler.runAfter(0, internal.voiceActions.reconcileFromWebhook, {
      blandCallId,
      callRecordId: callRecordId as Id<"calls"> | undefined,
    });
    return new Response("ok", { status: 200 });
  }),
});

/** Constant-time string comparison for shared secrets. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** GHL agency OAuth redirect: exchange the code, store agency tokens.
 *  Path says "crm" because GHL's white-label rules reject URLs containing
 *  "ghl"/"highlevel". */
http.route({
  path: "/crm/oauth/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const code = new URL(request.url).searchParams.get("code");
    if (!code) return new Response("Missing code", { status: 400 });
    try {
      const app = await ctx.runAction(
        internal.igDmsActions.completeAgencyInstall,
        { code },
      );
      return new Response(
        `<html><body style='font-family:system-ui;background:#0a0a0a;color:#eee;display:grid;place-items:center;height:100vh'><div style='text-align:center'><h2>✓ ${app} connected</h2><p>You can close this tab.</p></div></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : "install failed";
      return new Response(`GHL install failed: ${msg}`, { status: 500 });
    }
  }),
});

/**
 * GHL marketplace webhook. We only act on inbound Instagram messages for
 * locations we own; everything else is acknowledged and dropped.
 * TODO: verify x-wh-signature once live payloads confirm the header shape.
 */
http.route({
  path: "/crm/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const raw = await request.text();
    // Diagnostic (keep until IG payload shape is confirmed live).
    console.log("GHL-WEBHOOK:", raw.slice(0, 800));
    let payload: {
      type?: string;
      locationId?: string;
      conversationId?: string;
      contactId?: string;
      messageId?: string;
      messageType?: string;
      direction?: string;
      body?: string;
      dateAdded?: string;
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      return new Response("ok", { status: 200 });
    }
    const isInboundIg =
      payload.type === "InboundMessage" &&
      (payload.messageType ?? "").toUpperCase().includes("IG");
    if (
      isInboundIg &&
      payload.locationId &&
      payload.conversationId &&
      payload.contactId &&
      payload.body
    ) {
      const stored = await ctx.runMutation(internal.igDms.ingestInbound, {
        ghlLocationId: payload.locationId,
        ghlConversationId: payload.conversationId,
        ghlContactId: payload.contactId,
        ghlMessageId: payload.messageId,
        body: payload.body,
        sentAt: payload.dateAdded ? Date.parse(payload.dateAdded) : Date.now(),
      });
      if (stored) {
        // Name lookup is best-effort and must not block the webhook.
        const conversation = await ctx.runQuery(
          internal.igDms.getByGhlConversation,
          { ghlConversationId: payload.conversationId },
        );
        if (conversation && !conversation.contactName) {
          await ctx.scheduler.runAfter(
            0,
            internal.igDmsActions.resolveContactName,
            { conversationId: conversation._id },
          );
        }
      }
    }
    return new Response("ok", { status: 200 });
  }),
});

/**
 * Voice-note audio for GHL/Meta to fetch. Served under a ".wav"/".mp3" path so
 * attachment-type detection works — Convex's raw storage URLs carry no
 * extension. Ids are unguessable, same exposure as the storage URL itself.
 */
http.route({
  pathPrefix: "/crm/audio/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const name = new URL(request.url).pathname.split("/").pop() ?? "";
    const storageId = name.replace(/\.(wav|mp3)$/, "");
    if (!storageId) return new Response("Not found", { status: 404 });
    let blob: Blob | null = null;
    try {
      blob = await ctx.storage.get(storageId as Id<"_storage">);
    } catch {
      blob = null;
    }
    if (!blob) return new Response("Not found", { status: 404 });
    return new Response(blob, {
      status: 200,
      headers: {
        // WAV from Bland / PCM-tier ElevenLabs, MP3 from ElevenLabs otherwise.
        "Content-Type": blob.type.includes("mpeg") ? "audio/mpeg" : "audio/wav",
        "Content-Length": String(blob.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }),
});

// ── AI Note Taker (Recall.ai) ───────────────────────────────────────────

/**
 * Recall bot / transcript / calendar webhooks. The payload is only a poke:
 * state is always re-read from Recall's API, so a forged request can at
 * worst trigger a refresh. The signature is enforced once
 * RECALL_WEBHOOK_SECRET is set.
 */
http.route({
  path: "/notes/recall-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const raw = await request.text();
    const secret = process.env.RECALL_WEBHOOK_SECRET;
    if (secret) {
      const { verifyRecallSignature } = await import("./lib/recall");
      const h = request.headers;
      const valid = await verifyRecallSignature({
        secret,
        id: h.get("webhook-id") ?? h.get("svix-id"),
        timestamp: h.get("webhook-timestamp") ?? h.get("svix-timestamp"),
        signatureHeader: h.get("webhook-signature") ?? h.get("svix-signature"),
        rawBody: raw,
      });
      if (!valid) return new Response("bad signature", { status: 401 });
    }
    let payload: {
      event?: string;
      data?: {
        bot?: { id?: string };
        calendar_id?: string;
        last_updated_ts?: string;
      };
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      return new Response("ok", { status: 200 });
    }
    const event = String(payload.event ?? "");
    const botId = payload.data?.bot?.id;
    const calendarId = payload.data?.calendar_id;
    if (botId && /^(bot|transcript|recording)\./.test(event)) {
      await ctx.scheduler.runAfter(0, internal.noteTakerActions.onBotEvent, {
        recallBotId: botId,
      });
    } else if (calendarId && event.startsWith("calendar.")) {
      await ctx.scheduler.runAfter(0, internal.noteTakerActions.onCalendarEvent, {
        recallCalendarId: calendarId,
        event,
        lastUpdatedTs: payload.data?.last_updated_ts,
      });
    }
    return new Response("ok", { status: 200 });
  }),
});

/** Calendar OAuth landing (Google / Microsoft) → hand the grant to Recall. */
for (const provider of ["google", "microsoft"] as const) {
  http.route({
    path: `/notes/oauth/${provider}/callback`,
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      const params = new URL(request.url).searchParams;
      const code = params.get("code");
      const state = params.get("state");
      const page = (title: string, detail: string) =>
        new Response(
          `<html><body style='font-family:system-ui;background:#0a0a0a;color:#eee;display:grid;place-items:center;height:100vh'><div style='text-align:center;max-width:420px'><h2>${title}</h2><p style='color:#999'>${detail}</p></div></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      if (!code || !state) {
        return page(
          "Calendar not connected",
          params.get("error_description") ?? params.get("error") ?? "Missing code.",
        );
      }
      try {
        await ctx.runAction(internal.noteTakerActions.completeCalendarConnect, {
          provider,
          code,
          state,
        });
        return page("✓ Calendar connected", "You can close this tab.");
      } catch (error) {
        return page(
          "Calendar not connected",
          error instanceof Error ? error.message : "Something went wrong.",
        );
      }
    }),
  });
}

/**
 * Cal.com booking webhook, one secret URL per workspace
 * (/notes/calcom/<token>): BOOKING_CREATED / RESCHEDULED / CANCELLED keep a
 * bot scheduled for every booking that has a meeting link.
 */
http.route({
  pathPrefix: "/notes/calcom/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).pathname.split("/").pop() ?? "";
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    if (!token) return new Response("not found", { status: 404 });
    await ctx.scheduler.runAfter(0, internal.noteTakerActions.onCalcomBooking, {
      token,
      body,
    });
    return new Response("ok", { status: 200 });
  }),
});

/**
 * Higgsfield job webhook (Studio tab). Unsigned, so the payload is only a
 * poke: the job's true state is re-read from its status URL.
 */
http.route({
  path: "/create/higgsfield-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let payload: { request_id?: string };
    try {
      payload = (await request.json()) as { request_id?: string };
    } catch {
      return new Response("ok", { status: 200 });
    }
    if (typeof payload.request_id === "string" && payload.request_id) {
      await ctx.scheduler.runAfter(0, internal.studioActions.onWebhook, {
        requestId: payload.request_id,
      });
    }
    return new Response("ok", { status: 200 });
  }),
});

/**
 * Recall real-time transcript feed for the Agenda Coach. The bot is
 * configured with this URL (+ the meeting's secret token) and posts one
 * transcript.data event per finished utterance. Must answer 2xx fast —
 * Recall retries up to 60 times a second apart.
 */
http.route({
  path: "/notes/realtime",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) return new Response("missing token", { status: 401 });
    let payload: {
      event?: string;
      data?: {
        data?: {
          words?: {
            text?: string;
            start_timestamp?: { relative?: number } | null;
            end_timestamp?: { relative?: number } | null;
          }[];
          participant?: { name?: string | null } | null;
        };
        bot?: { id?: string };
      };
    };
    try {
      payload = await request.json();
    } catch {
      return new Response("ok", { status: 200 });
    }
    if (payload.event !== "transcript.data") return new Response("ok", { status: 200 });
    const words = payload.data?.data?.words ?? [];
    if (words.length === 0) return new Response("ok", { status: 200 });
    const text = words.map((w) => w.text ?? "").join(" ").replace(/\s+/g, " ").trim();
    const start = words[0]?.start_timestamp?.relative ?? 0;
    const last = words[words.length - 1];
    const end = last?.end_timestamp?.relative ?? last?.start_timestamp?.relative ?? start;
    const result = await ctx.runMutation(internal.noteTakerCoach.ingestRealtime, {
      token,
      botId: payload.data?.bot?.id,
      speaker: payload.data?.data?.participant?.name || "Speaker",
      start,
      end,
      text,
    });
    if (result?.scheduleTick) {
      await ctx.scheduler.runAfter(0, internal.noteTakerCoachAi.tick, {
        meetingId: result.meetingId,
      });
    }
    return new Response("ok", { status: 200 });
  }),
});

export default http;
