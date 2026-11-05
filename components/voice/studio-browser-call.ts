"use client";

/**
 * Browser test call on the Studio HD (ElevenLabs Agents) engine. The server
 * creates a throwaway agent and hands us a single-use WebRTC token; we only
 * connect mic + speakers and report the conversation id back on hang-up.
 * Transcript and duration are read server-side from ElevenLabs, never from
 * here.
 */
export type StudioCall = {
  /** Hang up; resolves to the conversation id (null if it never connected). */
  stop: () => Promise<string | null>;
};

export async function startStudioCall(opts: {
  conversationToken: string;
  /** The agent or network ended the call (not our own stop()). */
  onEnded: () => void;
}): Promise<StudioCall> {
  // Ask for the mic up front so a denial surfaces as a clear error.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
  const { Conversation } = await import("@elevenlabs/client");
  let stopping = false;
  const conversation = await Conversation.startSession({
    conversationToken: opts.conversationToken,
    connectionType: "webrtc",
    textOnly: false,
    onDisconnect: () => {
      if (!stopping) opts.onEnded();
    },
  });
  return {
    stop: async () => {
      stopping = true;
      let id: string | null = null;
      try {
        id = conversation.getId() || null;
      } catch {
        id = null;
      }
      try {
        await conversation.endSession();
      } catch {
        // Already closed.
      }
      return id;
    },
  };
}
