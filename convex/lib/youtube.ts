/**
 * Native YouTube transcript extraction — no third-party service, no cost.
 * Uses the innertube player API (ANDROID client dodges signature gating) to
 * find the video's caption track, then parses the timedtext XML.
 * Live-verified 2026-09-08 against a music video (srv3 <p>/<s> format).
 */

export function parseYouTubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const idOk = (s: string | null | undefined) =>
    s && /^[\w-]{11}$/.test(s) ? s : null;
  if (host === "youtu.be") return idOk(u.pathname.slice(1).split("/")[0]);
  if (host === "youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") return idOk(u.searchParams.get("v"));
    const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return idOk(m[2]);
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

type CaptionTrack = {
  baseUrl: string;
  languageCode: string;
  kind?: string; // "asr" = auto-generated
};

export async function fetchYouTubeTranscript(
  url: string,
): Promise<{ title: string; text: string }> {
  const videoId = parseYouTubeId(url);
  if (!videoId) throw new Error("That doesn't look like a YouTube video link");

  const playerRes = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "ANDROID",
          clientVersion: "20.10.38",
          androidSdkVersion: 30,
        },
      },
      videoId,
    }),
  });
  if (!playerRes.ok) {
    throw new Error(`Couldn't reach YouTube (${playerRes.status})`);
  }
  const data = (await playerRes.json()) as {
    playabilityStatus?: { status?: string; reason?: string };
    videoDetails?: { title?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
    };
  };

  const playability = data.playabilityStatus?.status;
  if (playability && playability !== "OK") {
    // LOGIN_REQUIRED from a datacenter IP = YouTube's bot wall (live-verified
    // from Convex 2026-09-08) — callers can fall back to a proxy-backed
    // extractor on this code.
    const blocked = playability === "LOGIN_REQUIRED";
    throw new Error(
      `${blocked ? "YT_BLOCKED: " : ""}YouTube won't serve this video (${data.playabilityStatus?.reason ?? playability})`,
    );
  }

  const tracks =
    data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) {
    throw new Error(
      "This video has no captions to pull — download its audio and upload the file here instead.",
    );
  }
  // Prefer human-made English, then any English, then whatever exists.
  const track =
    tracks.find((t) => t.languageCode.startsWith("en") && t.kind !== "asr") ??
    tracks.find((t) => t.languageCode.startsWith("en")) ??
    tracks[0];

  const capRes = await fetch(track.baseUrl);
  if (!capRes.ok) throw new Error(`Couldn't fetch captions (${capRes.status})`);
  const xml = await capRes.text();

  // srv3: <p t d><s>word</s>…</p>; legacy: <text start dur>line</text>
  let parts = [...xml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  if (parts.length === 0) {
    parts = [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]);
  }
  const text = parts
    .map((p) => decodeEntities(p.replace(/<[^>]+>/g, "")))
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new Error("The captions came back empty");

  return { title: data.videoDetails?.title ?? "", text };
}
