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
 * Voice-note audio for GHL/Meta to fetch. Served under a ".wav" path so
 * attachment-type detection works — Convex's raw storage URLs carry no
 * extension. Ids are unguessable, same exposure as the storage URL itself.
 */
http.route({
  pathPrefix: "/crm/audio/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const name = new URL(request.url).pathname.split("/").pop() ?? "";
    const storageId = name.replace(/.wav$/, "");
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
        "Content-Type": "audio/wav",
        "Content-Length": String(blob.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }),
});

export default http;
