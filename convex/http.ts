import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

/**
 * Bland AI posts here when a call ends. We look the call up via the
 * metadata.convexCallId we attach when initiating, bill per-second credits,
 * and store the transcript.
 */
http.route({
  path: "/bland-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = (await request.json()) as {
      call_id?: string;
      to?: string;
      from?: string;
      inbound?: boolean;
      call_length?: number; // minutes
      corrected_duration?: number; // seconds
      concatenated_transcript?: string;
      completed?: boolean;
      metadata?: { convexCallId?: string };
      analysis?: unknown;
    };
    const durationSec = Math.round(
      payload.corrected_duration ?? (payload.call_length ?? 0) * 60,
    );
    // Outbound calls carry the id in metadata; web-agent sessions can't set
    // metadata, so their webhook URL carries it as a query param instead.
    const convexCallId =
      payload.metadata?.convexCallId ??
      new URL(request.url).searchParams.get("callRecordId");
    if (convexCallId) {
      await ctx.runMutation(internal.voice.completeCall, {
        callId: convexCallId as Id<"calls">,
        durationSec,
        transcript: payload.concatenated_transcript,
        result: payload.analysis,
        failed: payload.completed === false,
      });
    } else if (payload.call_id && payload.to) {
      // A real inbound call — nothing pre-created a record for it, so make
      // one now and finish it (billing, transcript, analysis, auto-booking).
      const callId = await ctx.runMutation(internal.voice.recordInboundCall, {
        blandCallId: payload.call_id,
        toNumber: payload.to,
        fromNumber: payload.from ?? undefined,
      });
      if (callId) {
        await ctx.runMutation(internal.voice.completeCall, {
          callId,
          durationSec,
          transcript: payload.concatenated_transcript,
          failed: payload.completed === false,
        });
      }
    }
    return new Response("ok", { status: 200 });
  }),
});

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

export default http;
