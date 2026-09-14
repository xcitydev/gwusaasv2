/**
 * Apify REST adapter for lead-source actors. Runs are started async and
 * polled by a scheduled action. Gated on APIFY_API_TOKEN.
 */

const BASE = "https://api.apify.com/v2";

// Actor IDs are stable even if actors get renamed.
export const APIFY_ACTORS = {
  // compass/crawler-google-places (Google Maps Scraper)
  google_maps: "nwua9Gu5YrADL7ZDj",
  // harvestapi/linkedin-profile-search
  linkedin: "harvestapi~linkedin-profile-search",
  // cleansyntax/realtor-com-agents-scraper
  realtor_agents: "cleansyntax~realtor-com-agents-scraper",
} as const;

export function apifyConfigured(): boolean {
  return Boolean(process.env.APIFY_API_TOKEN);
}

function token(): string {
  const t = process.env.APIFY_API_TOKEN;
  if (!t) throw new Error("NOT_CONFIGURED: APIFY_API_TOKEN is not set");
  return t;
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}token=${token()}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Apify ${res.status} on ${path}: ${text.slice(0, 500)}`);
    let detail = "";
    try {
      detail = String((JSON.parse(text) as { error?: { message?: string } }).error?.message ?? "");
    } catch {
      detail = text.slice(0, 200);
    }
    throw new Error(`Apify ${res.status}: ${detail || "request failed"}`);
  }
  return (await res.json()) as T;
}

/**
 * Start an actor run without waiting for it. Every run carries a hard cost
 * ceiling — a Miami Beach ZIP once burned $8.45 because an actor had no
 * result cap. Returns the run id.
 */
export async function startActorRun(
  actorId: string,
  input: unknown,
  maxChargeUsd = 3,
): Promise<string> {
  const result = await call<{ data: { id: string } }>(
    `/acts/${actorId}/runs?maxTotalChargeUsd=${maxChargeUsd}`,
    { method: "POST", body: input },
  );
  return result.data.id;
}

export type ApifyRunStatus = {
  status: string; // READY | RUNNING | SUCCEEDED | FAILED | ABORTED | TIMED-OUT
  defaultDatasetId: string | null;
};

export async function getRun(runId: string): Promise<ApifyRunStatus> {
  const result = await call<{ data: { status: string; defaultDatasetId?: string } }>(
    `/actor-runs/${runId}`,
  );
  return {
    status: result.data.status,
    defaultDatasetId: result.data.defaultDatasetId ?? null,
  };
}

export async function getDatasetItems(
  datasetId: string,
  limit = 200,
): Promise<Record<string, unknown>[]> {
  return await call<Record<string, unknown>[]>(
    `/datasets/${datasetId}/items?clean=true&limit=${limit}`,
  );
}

/** Run an actor synchronously and return its dataset items (cost-capped). */
export async function runActorSync(
  actorId: string,
  input: unknown,
  opts: { maxChargeUsd?: number; timeoutSecs?: number } = {},
): Promise<Record<string, unknown>[]> {
  const maxCharge = opts.maxChargeUsd ?? 1;
  const timeout = opts.timeoutSecs ?? 120;
  return await call<Record<string, unknown>[]>(
    `/acts/${actorId}/run-sync-get-dataset-items?maxTotalChargeUsd=${maxCharge}&timeout=${timeout}`,
    { method: "POST", body: input },
  );
}

// ── Social video extraction (Audio-to-Text link support) ────────────────

/**
 * YouTube transcript via a proxy-backed store actor (pintostudio, 24k users)
 * — the fallback when YouTube bot-walls Convex's datacenter IPs. Output shape
 * is "segments with start/duration/text"; parsed defensively because the
 * exact field names ship in the dataset, not the schema.
 */
export async function apifyYouTubeTranscript(videoUrl: string): Promise<string> {
  const items = await runActorSync(
    "pintostudio~youtube-transcript-scraper",
    { videoUrl, targetLanguage: "en" },
    { maxChargeUsd: 1, timeoutSecs: 120 },
  );
  const parts: string[] = [];
  const pluck = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const seg of value) {
        if (seg && typeof seg === "object") {
          const t = (seg as Record<string, unknown>).text;
          if (typeof t === "string") parts.push(t);
        } else if (typeof seg === "string") parts.push(seg);
      }
    }
  };
  for (const item of items) {
    if (typeof item.text === "string") parts.push(item.text);
    else {
      pluck(item.data);
      pluck(item.transcript);
      pluck(item.captions);
      pluck(item.segments);
    }
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!text) {
    throw new Error(
      `Transcript service returned nothing usable (${JSON.stringify(items.slice(0, 1)).slice(0, 200)})`,
    );
  }
  return text;
}

/**
 * Resolve an Instagram or TikTok post link to a direct, fetchable video URL
 * that a speech-to-text provider can pull. Input schemas checked against the
 * actors' published OpenAPI 2026-09-08 (runs unverified live — Apify balance).
 */
export async function extractSocialVideoUrl(link: string): Promise<string> {
  const host = new URL(link).hostname.replace(/^www\./, "");

  if (host.endsWith("instagram.com")) {
    const items = await runActorSync("apify~instagram-scraper", {
      directUrls: [link],
      resultsType: "posts",
      resultsLimit: 1,
      addParentData: false,
    });
    // LIVE-VERIFIED 2026-09-08: IG serves reels as SEPARATE streams — videoUrl
    // is the silent video track (Deepgram sees duration 0); the sound lives at
    // audioUrl. Prefer audio, fall back to video for muxed posts.
    const audioUrl = items[0]?.audioUrl;
    if (typeof audioUrl === "string" && audioUrl) return audioUrl;
    const videoUrl = items[0]?.videoUrl;
    if (typeof videoUrl === "string" && videoUrl) return videoUrl;
    throw new Error(
      "Couldn't pull a video from that Instagram post — is it a video/reel and public?",
    );
  }

  if (host.endsWith("tiktok.com")) {
    // shouldDownloadVideos stores the file on Apify's CDN (public), which
    // matters because TikTok's own links are signature-locked.
    const items = await runActorSync("clockworks~tiktok-scraper", {
      postURLs: [link],
      resultsPerPage: 1,
      shouldDownloadVideos: true,
    });
    const item = items[0] as
      | { mediaUrls?: unknown[]; videoMeta?: { downloadAddr?: string } }
      | undefined;
    const stored = item?.mediaUrls?.find((u) => typeof u === "string");
    if (typeof stored === "string" && stored) return stored;
    if (item?.videoMeta?.downloadAddr) return item.videoMeta.downloadAddr;
    throw new Error(
      "Couldn't pull the video from that TikTok — is the post public?",
    );
  }

  throw new Error("Unsupported link");
}

// ── Per-source input builders ───────────────────────────────────────────

export function googleMapsInput(args: {
  searchString: string;
  locationQuery: string;
  limit: number;
}): unknown {
  return {
    searchStringsArray: [args.searchString],
    locationQuery: args.locationQuery,
    maxCrawledPlacesPerSearch: args.limit,
    language: "en",
    skipClosedPlaces: true,
    // Crawls each place's website for emails + socials.
    scrapeContacts: true,
    scrapePlaceDetailPage: false,
    maxReviews: 0,
    maxImages: 0,
    maxQuestions: 0,
  };
}

export function linkedinInput(args: {
  titles: string[];
  location: string | null;
  keywords: string[];
  limit: number;
}): unknown {
  // harvestapi/linkedin-profile-search — live-verified 2026-08-31 against the
  // actor's input schema. "Full + email search" is what activates emails.
  return {
    profileScraperMode: "Full + email search",
    currentJobTitles: args.titles,
    locations: args.location ? [args.location] : [],
    searchQuery: args.keywords.join(" ").trim(),
    maxItems: args.limit,
  };
}

export function realtorAgentsInput(args: { zipCodes: string[]; limit: number }): unknown {
  // Live-verified 2026-08-31: ZIPs as newline-separated text; maxResults caps
  // the run (dense ZIPs hold thousands of agents). NOTE: this actor returns
  // directory records with NO emails/phones — kept only for explicit requests.
  return { zipcodes_text: args.zipCodes.join("\n"), maxResults: args.limit };
}

// ── Per-source result mappers → FoundLead rows ──────────────────────────

export type FoundLead = {
  email: string;
  name: string;
  company: string;
  title: string;
  location: string;
  industry: string;
  website: string;
  phone: string;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function firstEmail(item: Record<string, unknown>): string {
  for (const key of ["emails", "email", "foundEmail", "contactEmail"]) {
    const value = item[key];
    if (typeof value === "string" && value.includes("@")) return value;
    if (Array.isArray(value)) {
      // harvestapi returns [{email, status: "valid", qualityScore}] objects;
      // prefer verified-deliverable entries, then fall back to any address.
      const entries = value.map((e) =>
        typeof e === "string"
          ? { email: e, valid: true }
          : e && typeof e === "object"
            ? {
                email: String((e as { email?: unknown }).email ?? ""),
                valid: (e as { status?: unknown }).status === "valid",
              }
            : { email: "", valid: false },
      );
      const hit =
        entries.find((e) => e.valid && e.email.includes("@")) ??
        entries.find((e) => e.email.includes("@"));
      if (hit) return hit.email;
    }
  }
  return "";
}

export function mapGoogleMapsItem(item: Record<string, unknown>): FoundLead {
  const city = str(item.city);
  const state = str(item.state);
  return {
    email: firstEmail(item),
    name: str(item.title),
    company: str(item.title),
    title: "",
    location: [city, state].filter(Boolean).join(", ") || str(item.address),
    industry: str(item.categoryName),
    website: str(item.website),
    phone: str(item.phone) || str(item.phoneUnformatted),
  };
}

export function mapLinkedinItem(item: Record<string, unknown>): FoundLead {
  // Live-verified item shape (harvestapi): location is an object, company +
  // position live in currentPosition[0].
  const first = str(item.firstName);
  const last = str(item.lastName);
  const name = str(item.fullName) || str(item.name) || `${first} ${last}`.trim();
  const currentPosition = Array.isArray(item.currentPosition)
    ? ((item.currentPosition[0] ?? {}) as Record<string, unknown>)
    : {};
  const locationObj = (item.location ?? {}) as Record<string, unknown>;
  const parsed = (locationObj.parsed ?? {}) as Record<string, unknown>;
  return {
    email: firstEmail(item),
    name,
    company: str(currentPosition.companyName) || str(item.companyName),
    title: str(currentPosition.position) || str(item.headline) || str(item.jobTitle),
    location:
      str(parsed.text) || str(locationObj.linkedinText) || str(item.locationName),
    industry: str(item.industry),
    website: str(item.linkedinUrl) || str(item.profileUrl) || str(item.url),
    phone: str(item.phone) || str(item.mobileNumber),
  };
}

export function mapRealtorItem(item: Record<string, unknown>): FoundLead {
  const name = str(item.name) || str(item.fullName) || str(item.agentName);
  return {
    email: firstEmail(item),
    name,
    company: str(item.brokerage) || str(item.office) || str(item.brokerageName),
    title: "Real Estate Agent",
    location: [str(item.city), str(item.state) || str(item.stateCode), str(item.zip) || str(item.zipCode)]
      .filter(Boolean)
      .join(", "),
    industry: "Real Estate",
    website: str(item.profileUrl) || str(item.url) || str(item.website),
    phone: str(item.phone) || str(item.phoneNumber) || str(item.mobile),
  };
}
