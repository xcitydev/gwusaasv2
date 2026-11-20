import { internalAction } from "./_generated/server";
import { v } from "convex/values";

/**
 * Admin diagnostic (CLI only: `npx convex run audioProbe:plan`): what the
 * connected ElevenLabs plan includes — tier, quota and TTS models.
 */
export const plan = internalAction({
  args: {},
  handler: async () => {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return { configured: false };
    const get = async (path: string) => {
      const res = await fetch(`https://api.elevenlabs.io${path}`, { headers: { "xi-api-key": key } });
      return { status: res.status, body: res.ok ? await res.json() : (await res.text()).slice(0, 300) };
    };
    const sub = await get("/v1/user/subscription");
    const models = await get("/v1/models");
    const s = sub.body as Record<string, unknown>;
    return {
      configured: true,
      subscription:
        sub.status === 200
          ? {
              tier: s.tier,
              status: s.status,
              character_count: s.character_count,
              character_limit: s.character_limit,
              next_reset_unix: s.next_character_count_reset_unix,
              voice_limit: s.voice_limit,
              can_use_instant_voice_cloning: s.can_use_instant_voice_cloning,
              can_use_professional_voice_cloning: s.can_use_professional_voice_cloning,
              currency: s.currency,
            }
          : sub,
      models:
        models.status === 200
          ? (models.body as { model_id: string; name: string; can_do_text_to_speech?: boolean; can_do_voice_conversion?: boolean; token_cost_factor?: number; languages?: unknown[] }[]).map(
              (m) => ({ id: m.model_id, name: m.name, tts: m.can_do_text_to_speech, sts: m.can_do_voice_conversion, cost: m.token_cost_factor, langs: m.languages?.length }),
            )
          : models,
    };
  },
});

/** Admin diagnostic (CLI only): transcribe a stored audio URL to check a result. */
export const transcribe = internalAction({
  args: { url: v.string() },
  handler: async (_ctx, args) => {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return { configured: false };
    const audio = await (await fetch(args.url)).blob();
    const form = new FormData();
    form.append("file", audio, "check.mp3");
    form.append("model_id", "scribe_v1");
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
    });
    const body = res.ok ? ((await res.json()) as { language_code?: string; text?: string }) : await res.text();
    return typeof body === "string" ? { status: res.status, body: body.slice(0, 300) } : { language: body.language_code, text: body.text };
  },
});
