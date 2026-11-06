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
        /** Cumulative amount refunded on a payment (partial refunds). */
        refunded_amount?: number;
        /** Dispute events: the disputed payment. */
        payment?: { id?: string; metadata?: Record<string, unknown> | null } | null;
        payment_id?: string;
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
    // been voided/refunded (fully or partly). The credits that payment
    // granted are clawed back pro rata and its referral commission voided.
    const refundLike =
      event.type === "payment.refunded" ||
      (Boolean(event.type?.startsWith("payment.")) &&
        event.type !== "payment.succeeded" &&
        (data.status === "void" ||
          data.substatus === "refunded" ||
          data.substatus === "partially_refunded"));
    if (refundLike && data.id) {
      const result = await ctx.runMutation(internal.whop.handlePaymentRefunded, {
        eventId: event.id ?? `${event.type}:${data.id}`,
        paymentId: data.id,
        metadata: data.metadata ?? undefined,
        usdTotal: typeof data.usd_total === "number" ? data.usd_total : undefined,
        // A void has no refunded amount: treated as the full payment.
        refundedUsd:
          data.status !== "void" && typeof data.refunded_amount === "number"
            ? data.refunded_amount
            : undefined,
        kind: "refund",
      });
      console.log("WHOP-WEBHOOK:", event.type, data.id, result.handled);
      return new Response("ok", { status: 200 });
    }

    // Chargebacks: claw back like a full refund, once per disputed payment
    // (a later won dispute is re-granted by hand from the admin incident).
    const disputedPaymentId = data.payment?.id ?? data.payment_id;
    if (event.type?.startsWith("dispute.") && disputedPaymentId) {
      const result = await ctx.runMutation(internal.whop.handlePaymentRefunded, {
        eventId: event.id ?? `${event.type}:${data.id ?? disputedPaymentId}`,
        paymentId: disputedPaymentId,
        metadata: data.payment?.metadata ?? data.metadata ?? undefined,
        kind: "dispute",
      });
      console.log("WHOP-WEBHOOK:", event.type, disputedPaymentId, result.handled);
      return new Response("ok", { status: 200 });
    }

    // Anything else: acknowledge, keep a trace.
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
    if (!secret) warnUnsignedOnce("BLAND_WEBHOOK_SECRET", "/bland-webhook");
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

/**
 * ElevenLabs Agents post-call webhook (workspace setting in ElevenLabs →
 * Agents → Settings → Webhooks, pointed at <CONVEX_SITE_URL>/elevenlabs-webhook).
 * Signed with ELEVENLABS_WEBHOOK_SECRET (HMAC); unsigned requests are refused
 * once the secret is set. Like Bland's, the body is only a poke: the
 * conversation is re-read from ElevenLabs before any record or credit moves.
 */
http.route({
  path: "/elevenlabs-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const raw = await request.text();
    const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
    if (!secret) warnUnsignedOnce("ELEVENLABS_WEBHOOK_SECRET", "/elevenlabs-webhook");
    if (secret) {
      const { verifyWebhookSignature } = await import("./lib/elevenAgents");
      const ok = await verifyWebhookSignature(
        raw,
        request.headers.get("elevenlabs-signature"),
        secret,
      );
      if (!ok) return new Response("unauthorized", { status: 401 });
    }
    let payload: { type?: unknown; data?: { conversation_id?: unknown } };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const conversationId =
      typeof payload.data?.conversation_id === "string"
        ? payload.data.conversation_id.trim()
        : "";
    // Audio payloads carry nothing we use; transcription + failures do.
    if (conversationId && payload.type !== "post_call_audio") {
      await ctx.scheduler.runAfter(0, internal.voiceActions.reconcileElevenConversation, {
        conversationId,
      });
    }
    return new Response("ok", { status: 200 });
  }),
});

/**
 * Loud, once-per-isolate warning that a webhook secret is unset and the
 * route is accepting unauthenticated pokes (kept working on purpose until
 * the secret is configured — the payloads are re-verified upstream).
 */
const warnedUnsigned = new Set<string>();
function warnUnsignedOnce(envName: string, route: string): void {
  if (warnedUnsigned.has(envName)) return;
  warnedUnsigned.add(envName);
  console.warn(
    `SECURITY: ${envName} is not set — ${route} accepts unauthenticated requests. Set it on the deployment to enforce.`,
  );
}

/** Text that may come from a query string, safe inside HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Minimal dark status page for OAuth landings. Inputs are escaped. */
function statusPage(title: string, detail: string, status = 200): Response {
  return new Response(
    `<html><body style='font-family:system-ui;background:#0a0a0a;color:#eee;display:grid;place-items:center;height:100vh'><div style='text-align:center;max-width:420px'><h2>${escapeHtml(title)}</h2><p style='color:#999'>${escapeHtml(detail)}</p></div></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

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
    const params = new URL(request.url).searchParams;
    const code = params.get("code");
    // The state is minted by an admin's agencyInstallUrl call; without it
    // anyone could push a code here and replace the platform-wide tokens.
    const state = params.get("state");
    if (!code) return statusPage("Install failed", "Missing code.", 400);
    if (!state) {
      return statusPage(
        "Install failed",
        "Missing state — start the install from the admin panel link.",
        400,
      );
    }
    try {
      const app = await ctx.runAction(
        internal.igDmsActions.completeAgencyInstall,
        { code, state },
      );
      return statusPage(`✓ ${app} connected`, "You can close this tab.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "install failed";
      return statusPage("Install failed", msg, 400);
    }
  }),
});

/**
 * GHL marketplace webhook. We only act on inbound Instagram messages for
 * locations we own; everything else is acknowledged and dropped. Every
 * delivery must carry a valid GHL signature (X-GHL-Signature Ed25519, or
 * the legacy X-WH-Signature RSA) over the raw body — checked in Node
 * (igAi.verifyGhlWebhook) before anything in the body is trusted.
 */
http.route({
  path: "/crm/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const raw = await request.text();
    if (process.env.GHL_WEBHOOK_SKIP_VERIFY === "1") {
      warnUnsignedOnce("GHL_WEBHOOK_SKIP_VERIFY=1 (signature check off)", "/crm/webhook");
    } else {
      const valid = await ctx.runAction(internal.igAi.verifyGhlWebhook, {
        rawBody: raw,
        ghlSignature: request.headers.get("x-ghl-signature") ?? undefined,
        whSignature: request.headers.get("x-wh-signature") ?? undefined,
      });
      if (!valid) {
        // No body in the log: it carries DM text and contact ids.
        console.error(
          "GHL-WEBHOOK: rejected, invalid signature",
          JSON.stringify({
            hasGhlSignature: Boolean(request.headers.get("x-ghl-signature")),
            hasWhSignature: Boolean(request.headers.get("x-wh-signature")),
            bodyBytes: raw.length,
          }),
        );
        return new Response("invalid signature", { status: 401 });
      }
    }
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
      if (stored?.needsName) {
        // Name lookup is best-effort and must not block the webhook.
        await ctx.scheduler.runAfter(
          0,
          internal.igDmsActions.resolveContactName,
          { conversationId: stored.conversationId },
        );
      }
    }
    return new Response("ok", { status: 200 });
  }),
});

/**
 * Voice-note audio for GHL/Meta to fetch. Served under a ".wav"/".mp3" path so
 * attachment-type detection works — Convex's raw storage URLs carry no
 * extension. Only blobs registered as voice-note renders (igVoiceNotes) are
 * served; every other storage id 404s, so this can't read arbitrary files.
 */
http.route({
  pathPrefix: "/crm/audio/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const name = new URL(request.url).pathname.split("/").pop() ?? "";
    const storageId = name.replace(/\.(wav|mp3)$/, "");
    if (!storageId) return new Response("Not found", { status: 404 });
    const registered = await ctx.runQuery(internal.igDms.isVoiceNote, { storageId });
    if (!registered) return new Response("Not found", { status: 404 });
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
    if (!secret) warnUnsignedOnce("RECALL_WEBHOOK_SECRET", "/notes/recall-webhook");
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

/**
 * Calendar OAuth landing (Google / Microsoft). The grant is parked, not
 * attached: the browser is sent on to the app's confirm page with a
 * one-shot nonce, and the calendar only connects if the signed-in user
 * there is the one who started the flow (stops consent-link phishing).
 */
for (const provider of ["google", "microsoft"] as const) {
  http.route({
    path: `/notes/oauth/${provider}/callback`,
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      const params = new URL(request.url).searchParams;
      const code = params.get("code");
      const state = params.get("state");
      if (!code || !state) {
        return statusPage(
          "Calendar not connected",
          (params.get("error_description") ?? params.get("error") ?? "Missing code.").slice(0, 300),
        );
      }
      const appUrl = process.env.APP_URL?.replace(/\/$/, "");
      if (!appUrl) {
        console.error("Calendar connect: APP_URL is not set, can't confirm in-app");
        return statusPage(
          "Calendar not connected",
          "Calendar connect isn't fully set up on the platform yet.",
        );
      }
      try {
        const nonce = await ctx.runAction(internal.noteTakerActions.completeCalendarConnect, {
          provider,
          code,
          state,
        });
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${appUrl}/note-taker/connect?nonce=${encodeURIComponent(nonce)}`,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      } catch (error) {
        return statusPage(
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
    if (!token) return new Response("not found", { status: 404 });
    // Raw text kept for the X-Cal-Signature-256 HMAC (checked in
    // onCalcomBooking against the workspace's signing secret).
    const rawBody = await request.text();
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response("bad json", { status: 400 });
    }
    await ctx.scheduler.runAfter(0, internal.noteTakerActions.onCalcomBooking, {
      token,
      body,
      rawBody,
      signature: request.headers.get("x-cal-signature-256") ?? undefined,
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
