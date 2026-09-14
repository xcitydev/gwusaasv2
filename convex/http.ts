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

export default http;
