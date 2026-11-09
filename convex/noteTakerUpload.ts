import { internalAction } from "./_generated/server";
import { action } from "./lib/functions";
import { internal, api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { assertPlanAction } from "./lib/plan";
import { SttError, sttConfigured, transcribeRecording } from "./lib/stt";
import { chunkSegments, computeAnalytics } from "./lib/transcript";

/**
 * Uploaded recordings (in-person meetings, Slack huddles, phone calls):
 * file → speaker-labelled transcript → the same store/bill/notes path a bot
 * recording takes, so search, Ask, scores and coaching all just work.
 */

export const uploadMeeting = action({
  args: {
    storageId: v.id("_storage"),
    title: v.optional(v.string()),
    fileName: v.string(),
  },
  handler: async (ctx, args): Promise<{ meetingId: Id<"meetings"> }> => {
    await assertPlanAction(ctx, "personal", "AI Note Taker");
    if (!sttConfigured()) {
      throw new Error("NOT_CONFIGURED: Uploads aren't switched on for the platform yet.");
    }
    const meetingId = await ctx.runMutation(api.noteTaker.createUploadMeeting, args);
    await ctx.scheduler.runAfter(0, internal.noteTakerUpload.transcribeUpload, {
      meetingId,
      fileName: args.fileName,
    });
    return { meetingId };
  },
});

export const transcribeUpload = internalAction({
  args: { meetingId: v.id("meetings"), fileName: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const meeting = await ctx.runQuery(internal.noteTaker.getMeetingInternal, {
      meetingId: args.meetingId,
    });
    if (!meeting?.mediaStorageId || meeting.finalizedAt) return;
    const fail = async (detail: string) =>
      await ctx.runMutation(internal.noteTaker.patchMeeting, {
        meetingId: args.meetingId,
        status: "failed",
        statusDetail: detail,
        failureCode: "other",
      });
    try {
      const url = await ctx.storage.getUrl(meeting.mediaStorageId);
      if (!url) {
        await fail("The uploaded file is gone — upload it again.");
        return;
      }
      const { segments, durationSec } = await transcribeRecording(url, args.fileName);
      if (segments.length === 0) {
        await fail("No speech was found in that recording.");
        return;
      }
      const speakers = [...new Set(segments.map((s) => s.speaker))];
      const result = await ctx.runMutation(internal.noteTaker.storeRecording, {
        meetingId: args.meetingId,
        startedAt: meeting.startedAt,
        endedAt: (meeting.startedAt ?? Date.now()) + durationSec * 1000,
        durationSec,
        attendees: speakers.map((name) => ({ name })),
        analytics: computeAnalytics(segments),
        parts: chunkSegments(segments),
      });
      if (result.stored) {
        await ctx.scheduler.runAfter(0, internal.noteTakerAi.generateNotes, {
          meetingId: args.meetingId,
        });
      }
    } catch (error) {
      console.error("Note taker: upload transcription failed", error);
      await fail(
        error instanceof SttError
          ? error.message.replace("NOT_CONFIGURED: ", "")
          : "Transcribing the recording failed — try uploading it again.",
      );
    }
  },
});
