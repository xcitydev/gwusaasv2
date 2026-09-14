"use node";

import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { z } from "zod";

/**
 * AI-powered actions. Runs in the Node runtime because the Anthropic SDK
 * needs node builtins. Each action degrades gracefully when
 * ANTHROPIC_API_KEY isn't set on the deployment.
 */

const filtersSchema = z.object({
  source: z.enum(["google_maps", "linkedin", "explorium", "realtor_agents"]),
  industry: z.string().nullable(),
  jobTitles: z.array(z.string()),
  country: z.string().nullable(),
  region: z.string().nullable(),
  city: z.string().nullable(),
  zipCodes: z.array(z.string()),
  companySize: z.string().nullable(),
  keywords: z.array(z.string()),
  // "get me 100 med spas…" — null when the user didn't say a number.
  requestedCount: z.number().nullable(),
  // For Google Maps: what to type in the Maps search box + where.
  mapsSearchString: z.string().nullable(),
  locationQuery: z.string().nullable(),
});

export type LeadFilters = z.infer<typeof filtersSchema>;

type FoundLead = {
  email: string;
  name: string;
  company: string;
  title: string;
  location: string;
  industry: string;
  website: string;
  phone: string;
};

/**
 * AI Company Search: free text in → structured filters + source routing →
 * async provider job. The UI subscribes to the returned search id; Apify
 * sources are polled by a scheduled action, Explorium runs inline. Sources
 * whose keys aren't configured fall back to clearly-labeled samples.
 */
export const leadSearch = action({
  args: {
    query: v.string(),
    forceSource: v.optional(
      v.union(
        v.literal("google_maps"),
        v.literal("linkedin"),
        v.literal("explorium"),
        v.literal("realtor_agents"),
      ),
    ),
    // Explicit UI choice; falls back to a count in the query text, then 50.
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ searchId: Id<"leadSearches"> }> => {
    const queryText = args.query.trim();
    if (!queryText) throw new Error("Describe who you're looking for");

    const filters = process.env.ANTHROPIC_API_KEY
      ? await parseWithClaude(queryText)
      : parseHeuristically(queryText);
    const source = args.forceSource ?? filters.source;
    // Custom counts up to 1000; the per-run Apify cost ceiling scales with
    // the request (~2¢/lead headroom) so big pulls work but can't run away.
    const limit = Math.max(1, Math.min(1000, Math.round(args.limit ?? filters.requestedCount ?? 50)));
    const maxChargeUsd = Math.max(3, Math.ceil(limit * 0.02));

    const { apifyConfigured } = await import("./lib/apify");
    const { exploriumConfigured } = await import("./lib/explorium");
    const configured =
      source === "explorium" ? exploriumConfigured() : apifyConfigured();

    const searchId: Id<"leadSearches"> = await ctx.runMutation(
      internal.leadSearches.createSearch,
      { query: queryText, filters, source, sample: !configured, limit },
    );

    if (!configured) {
      await ctx.runMutation(internal.leadSearches.storeResults, {
        id: searchId,
        results: generateSampleResults(filters),
      });
      return { searchId };
    }

    try {
      if (source === "explorium") {
        const { fetchProspects } = await import("./lib/explorium");
        const { rows, warning } = await fetchProspects({
          jobTitles: filters.jobTitles,
          country: filters.country,
          region: filters.region,
          city: filters.city,
          industry: filters.industry,
          limit,
        });
        await ctx.runMutation(internal.leadSearches.storeResults, {
          id: searchId,
          results: rows,
          ...(warning && {
            warning: `Profiles found, but contact enrichment failed: ${warning}`,
          }),
        });
        return { searchId };
      }

      const apify = await import("./lib/apify");
      const location =
        filters.locationQuery ??
        [filters.city, filters.region, filters.country].filter(Boolean).join(", ");
      let runId: string;
      if (source === "google_maps") {
        runId = await apify.startActorRun(
          apify.APIFY_ACTORS.google_maps,
          apify.googleMapsInput({
            searchString:
              filters.mapsSearchString ??
              [filters.industry, ...filters.keywords].filter(Boolean).join(" ") ??
              queryText,
            locationQuery: location || "United States",
            limit,
          }),
          maxChargeUsd,
        );
      } else if (source === "realtor_agents") {
        if (filters.zipCodes.length === 0) {
          throw new Error(
            "Realtor.com search needs ZIP codes — include them in your search (e.g. 'realtors in 33139, 33140').",
          );
        }
        runId = await apify.startActorRun(
          apify.APIFY_ACTORS.realtor_agents,
          apify.realtorAgentsInput({ zipCodes: filters.zipCodes, limit }),
          maxChargeUsd,
        );
      } else {
        runId = await apify.startActorRun(
          apify.APIFY_ACTORS.linkedin,
          apify.linkedinInput({
            titles: filters.jobTitles,
            location: location || null,
            keywords: filters.keywords,
            limit,
          }),
          maxChargeUsd,
        );
      }
      await ctx.runMutation(internal.leadSearches.setRunId, {
        id: searchId,
        apifyRunId: runId,
      });
      await ctx.scheduler.runAfter(10_000, internal.leadProviders.pollApifyRun, {
        searchId,
        attempts: 0,
      });
    } catch (error) {
      await ctx.runMutation(internal.leadSearches.failSearch, {
        id: searchId,
        error: error instanceof Error ? error.message : "Couldn't start the search",
      });
    }
    return { searchId };
  },
});

const auditResultSchema = z.object({
  summary: z.string(),
  seoFindings: z.array(z.object({ title: z.string(), detail: z.string(), severity: z.enum(["good", "warning", "critical"]) })),
  aiVisibilityFindings: z.array(z.object({ title: z.string(), detail: z.string(), severity: z.enum(["good", "warning", "critical"]) })),
  recommendations: z.array(z.string()),
  competitors: z.array(z.object({ name: z.string(), reason: z.string() })),
});

/**
 * Get Found by AI: audit a website/business for SEO + AI-agent visibility,
 * including likely competitors. Result is stored in Convex for later access.
 */
export const runAudit = action({
  args: { target: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Id<"audits">> => {
    const target = args.target.trim();
    if (!target) throw new Error("Enter a website or describe your business");
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "NOT_CONFIGURED: AI tools need ANTHROPIC_API_KEY on the deployment.",
      );
    }

    const auditId = await ctx.runMutation(internal.tools.startAudit, { target });

    try {
      // Pull the homepage when the target looks like a URL, so the audit has
      // real content to work from.
      let siteContent = "";
      if (/^https?:\/\//.test(target) || /^[a-z0-9-]+(\.[a-z0-9-]+)+/.test(target)) {
        const url = target.startsWith("http") ? target : `https://${target}`;
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SiteAudit/1.0)" },
          });
          if (res.ok) {
            siteContent = (await res.text())
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .slice(0, 30000);
          }
        } catch {
          // Site unreachable — audit proceeds from the description alone.
        }
      }

      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
      const client = new Anthropic();
      const response = await client.messages.parse({
        model: "claude-opus-5",
        max_tokens: 16000,
        system:
          "You are an expert in SEO and AI-agent discoverability (how well " +
          "ChatGPT, Claude, Perplexity and Google AI Overviews can find and " +
          "recommend a business). Audit the business below. Be specific and " +
          "actionable; findings must reference what you actually observed. " +
          "For competitors, name realistic competitor types or known brands " +
          "in their space with the reason they compete.",
        messages: [
          {
            role: "user",
            content:
              `Business/website: ${target}\n` +
              (args.description ? `Description: ${args.description}\n` : "") +
              (siteContent
                ? `\nHomepage HTML (truncated):\n${siteContent}`
                : "\n(No site content available — audit from the name/description.)"),
          },
        ],
        output_config: { format: zodOutputFormat(auditResultSchema) },
      });

      if (!response.parsed_output) throw new Error("Audit produced no result");
      await ctx.runMutation(internal.tools.finishAudit, {
        id: auditId,
        status: "done",
        result: response.parsed_output,
      });
    } catch (error) {
      await ctx.runMutation(internal.tools.finishAudit, {
        id: auditId,
        status: "failed",
        error: error instanceof Error ? error.message : "Audit failed",
      });
      throw new Error("Audit failed — please try again.");
    }
    return auditId;
  },
});

/**
 * Audio to text. Uploads and links (YouTube/IG/TikTok detected client-side)
 * are stored immediately; transcription runs when a speech-to-text provider
 * key (DEEPGRAM_API_KEY) is configured.
 */
export const transcribe = action({
  args: {
    sourceType: v.union(v.literal("upload"), v.literal("link")),
    source: v.string(),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args): Promise<Id<"transcripts">> => {
    const transcriptId = await ctx.runMutation(internal.tools.startTranscript, {
      sourceType: args.sourceType,
      source: args.source,
      storageId: args.storageId,
    });
    await runTranscription(ctx, transcriptId, args);
    return transcriptId;
  },
});

/** Re-run a failed transcript in place (same row, fresh attempt). */
export const retryTranscribe = action({
  args: { id: v.id("transcripts") },
  handler: async (ctx, args): Promise<void> => {
    const transcript = await ctx.runQuery(internal.tools.getTranscript, {
      id: args.id,
    });
    if (!transcript) throw new Error("Transcript not found");
    // Owner check + status reset happen in the mutation (throws if not theirs).
    await ctx.runMutation(internal.tools.restartTranscript, { id: args.id });
    await runTranscription(ctx, args.id, {
      sourceType: transcript.sourceType,
      source: transcript.source,
      storageId: transcript.storageId,
    });
  },
});

async function runTranscription(
  ctx: ActionCtx,
  transcriptId: Id<"transcripts">,
  args: {
    sourceType: "upload" | "link";
    source: string;
    storageId?: Id<"_storage">;
  },
): Promise<void> {
    try {
      let audioUrl = args.source;
      if (args.sourceType === "upload" && args.storageId) {
        const url = await ctx.storage.getUrl(args.storageId);
        if (!url) throw new Error("Uploaded file not found");
        audioUrl = url;
      } else if (args.sourceType === "link") {
        const link = args.source.trim();
        const { parseYouTubeId, fetchYouTubeTranscript } = await import(
          "./lib/youtube"
        );
        if (parseYouTubeId(link)) {
          // YouTube: pull the video's own captions — instant and free when
          // YouTube serves us; datacenter IPs often hit its bot wall, so a
          // proxy-backed Apify actor is the fallback.
          let transcriptText: string;
          try {
            const { title, text } = await fetchYouTubeTranscript(link);
            transcriptText = title ? `${title}\n\n${text}` : text;
          } catch (error) {
            const msg = error instanceof Error ? error.message : "";
            const { apifyConfigured, apifyYouTubeTranscript } = await import(
              "./lib/apify"
            );
            if (!msg.startsWith("YT_BLOCKED:") || !apifyConfigured()) throw error;
            transcriptText = await apifyYouTubeTranscript(link);
          }
          await ctx.runMutation(internal.tools.finishTranscript, {
            id: transcriptId,
            status: "done",
            text: transcriptText,
          });
          return;
        }
        const host = (() => {
          try {
            return new URL(link).hostname.replace(/^www\./, "");
          } catch {
            throw new Error("That doesn't look like a valid link");
          }
        })();
        if (host.endsWith("instagram.com") || host.endsWith("tiktok.com")) {
          // Social posts: resolve to a real video file first.
          const { extractSocialVideoUrl } = await import("./lib/apify");
          audioUrl = await extractSocialVideoUrl(link);
        }
      }

      if (!process.env.DEEPGRAM_API_KEY) {
        throw new Error(
          "Transcription engine not connected yet (DEEPGRAM_API_KEY). Your file is saved — retry once it's configured.",
        );
      }
      const res = await fetch(
        "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: audioUrl }),
        },
      );
      if (res.status === 415 || res.status === 400) {
        throw new Error(
          "That link isn't a playable audio/video file. Paste a YouTube, Instagram or TikTok link — or upload the file directly.",
        );
      }
      if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
      const data = (await res.json()) as {
        metadata?: { duration?: number };
        results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
      };
      const text =
        data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
      if (!text) {
        // duration 0 = the file genuinely has no audio track (IG's split
        // video-only streams looked like this before the audioUrl fix).
        throw new Error(
          data.metadata?.duration === 0
            ? "That file has no audio track in it."
            : "No speech detected in the audio.",
        );
      }
      await ctx.runMutation(internal.tools.finishTranscript, {
        id: transcriptId,
        status: "done",
        text,
      });
    } catch (error) {
      await ctx.runMutation(internal.tools.finishTranscript, {
        id: transcriptId,
        status: "failed",
        error: error instanceof Error ? error.message : "Transcription failed",
      });
    }
}

const carouselPlanSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()),
  slides: z.array(
    z.object({
      heading: z.string(),
      body: z.string(),
      imagePrompt: z.string(),
    }),
  ),
});

// Template mode: every field required, empty string / empty array = unused —
// structured outputs are far more reliable without optionals.
const carouselDeckSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()),
  slides: z.array(
    z.object({
      type: z.enum(["cover", "point", "stat", "quote", "cta"]),
      kicker: z.string(),
      headline: z.string(),
      dek: z.string(),
      items: z.array(z.object({ title: z.string(), body: z.string() })),
      stat: z.string(),
      statLabel: z.string(),
      quote: z.string(),
      attribution: z.string(),
      keyword: z.string(),
      keywordLabel: z.string(),
      cta: z.string(),
      scene: z.string(),
    }),
  ),
});

/**
 * Template mode step 1 — FREE: Claude plans the structured deck (slide types,
 * kickers, headlines with accent markup, background scene briefs) and the user
 * reviews/edits every slide in the template BEFORE any credits are spent.
 * Backgrounds only render when they approve via renderCarousel.
 */
export const planCarousel = action({
  args: {
    topic: v.string(),
    brand: v.optional(v.string()),
    templateId: v.string(),
    slideCount: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"carousels">> => {
    if (!args.topic.trim()) throw new Error("Describe what the carousel is about");
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("NOT_CONFIGURED: carousels need ANTHROPIC_API_KEY.");
    }
    const slideCount = Math.max(3, Math.min(10, Math.round(args.slideCount)));
    // Resolves built-ins AND admin library templates (DB-backed).
    const template = await ctx.runQuery(internal.carouselTemplates.resolve, {
      templateId: args.templateId,
    });
    if (!template) throw new Error("Unknown carousel template");

    const carouselId: Id<"carousels"> = await ctx.runMutation(
      internal.carousels.startDraft,
      { topic: args.topic, brand: args.brand, templateId: template.id },
    );
    try {
      await planDeck(ctx, { carouselId, topic: args.topic, slideCount, template });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Planning failed";
      await ctx.runMutation(internal.carousels.finish, {
        id: carouselId,
        status: "failed",
        error: detail,
      });
      throw new Error(`Couldn't write the slides. (${detail})`);
    }
    return carouselId;
  },
});

/**
 * Template mode step 2: the user approved the plan — charge for the
 * backgrounds, render them in parallel, refund if anything fails.
 */
export const renderCarousel = action({
  args: { id: v.id("carousels") },
  handler: async (ctx, args): Promise<void> => {
    if (!process.env.FAL_KEY) {
      throw new Error("NOT_CONFIGURED: carousels need FAL_KEY.");
    }
    const carousel = await ctx.runQuery(internal.carousels.get, { id: args.id });
    if (!carousel) throw new Error("Carousel not found");
    const template = carousel.templateId
      ? await ctx.runQuery(internal.carouselTemplates.resolve, {
          templateId: carousel.templateId,
        })
      : null;
    if (!template) throw new Error("Unknown template");
    const deck = carousel.deck;
    if (!deck || deck.length === 0) throw new Error("No slide plan yet");

    // Charges + validates ownership/status; throws before any fal spend.
    await ctx.runMutation(internal.carousels.chargeAndRun, { id: args.id });

    try {
      const { runFal } = await import("./lib/fal");
      const { findImageModel } = await import("../lib/ai-models");
      const provider = findImageModel(template.bgModelId)!.provider;
      await Promise.all(
        deck.map(async (slide, index) => {
          const bgUrl = await runFal(provider, {
            prompt: slide.imagePrompt,
            resolution: "1024×1280", // exact 4:5, multiples of 32
            kind: "image",
          });
          await ctx.runMutation(internal.carousels.setDeckSlideUrl, {
            id: args.id,
            index,
            bgUrl,
          });
        }),
      );
      await ctx.runMutation(internal.carousels.finish, {
        id: args.id,
        status: "done",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Generation failed";
      await ctx.runMutation(internal.carousels.finish, {
        id: args.id,
        status: "failed",
        error: detail,
      });
      throw new Error(`Carousel failed — your credits were refunded. (${detail})`);
    }
  },
});

/**
 * Classic mode ("AI Art"): Claude writes a full Ideogram design prompt per
 * slide, the model renders text ON the image. Charged up front, refund on fail.
 */
export const generateCarousel = action({
  args: {
    topic: v.string(),
    brand: v.optional(v.string()),
    colors: v.optional(v.string()),
    vibe: v.optional(v.string()),
    slideCount: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"carousels">> => {
    if (!args.topic.trim()) throw new Error("Describe what the carousel is about");
    if (!process.env.ANTHROPIC_API_KEY || !process.env.FAL_KEY) {
      throw new Error(
        "NOT_CONFIGURED: carousels need ANTHROPIC_API_KEY and FAL_KEY.",
      );
    }
    const slideCount = Math.max(3, Math.min(10, Math.round(args.slideCount)));

    const { carouselId } = await ctx.runMutation(internal.carousels.start, {
      topic: args.topic,
      brand: args.brand,
      vibe: args.vibe,
      modelId: "ideogram-v3",
      slideCount,
    });

    try {
      await generateClassicCarousel(ctx, { carouselId, args, slideCount });
      await ctx.runMutation(internal.carousels.finish, {
        id: carouselId,
        status: "done",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Generation failed";
      await ctx.runMutation(internal.carousels.finish, {
        id: carouselId,
        status: "failed",
        error: detail,
      });
      throw new Error(`Carousel failed — your credits were refunded. (${detail})`);
    }
    return carouselId;
  },
});

/** Claude writes the deck plan and stores it (no image spend). */
async function planDeck(
  ctx: ActionCtx,
  input: {
    carouselId: Id<"carousels">;
    topic: string;
    slideCount: number;
    template: import("../lib/carousel-templates").CarouselTemplate;
  },
): Promise<void> {
  const { carouselId, topic, slideCount, template } = input;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 10000,
    system:
      `Plan an Instagram carousel deck with EXACTLY ${slideCount} slides. ` +
      "Slide 1 must be type 'cover' (a scroll-stopping hook), the last slide " +
      "type 'cta', middle slides mostly type 'point' (one concrete, valuable " +
      "idea each) — you may use at most one 'stat' slide (a single striking " +
      "number) and at most one 'quote' slide if the topic truly calls for it.\n\n" +
      "Fields (empty string / empty array = leave unused):\n" +
      "- kicker: tiny label above the headline, ≤ 4 words (e.g. 'Leak 01 · Speed', " +
      "'The reframe', 'Your move'). Number the point slides when it fits.\n" +
      "- headline: the big line, ≤ 9 words, use \\n to break into 2-3 punchy " +
      "lines. Markup: wrap the 1-3 most important words in [[double brackets]] " +
      "for the accent color; use ~~tildes~~ to strike through a myth being " +
      "debunked (great on covers and myth slides); {{braces}} for a rare second " +
      "accent (at most one slide). Never nest markup.\n" +
      "- dek: supporting line under the headline, ≤ 26 words, plain text.\n" +
      "- items: 0-3 {title, body} bullets, ONLY when a list genuinely helps " +
      "(title ≤ 7 words, may use [[accent]]; body ≤ 18 words).\n" +
      "- stat + statLabel: only on the 'stat' slide (stat like '72h' or '83%', " +
      "label ≤ 8 words).\n" +
      "- quote + attribution: only on the 'quote' slide.\n" +
      "- keyword + keywordLabel: only on the 'cta' slide — a single UPPERCASE " +
      "comment word (e.g. 'AUDIT') with label like 'comment this word'.\n" +
      "- cta: short action line shown in the bottom band (cover: what swiping " +
      "gives them; cta slide: the ask). Use on cover and cta slides only.\n" +
      "- scene: a background image brief for THAT slide — a concrete cinematic " +
      "VISUAL METAPHOR for the slide's message (objects, environment, action, " +
      "lighting). All scenes must live in one consistent visual world so the " +
      "deck feels like a series. Describe ONLY the scene — NO text, letters, " +
      "signs, screens with writing, or logos, and keep the main subject in the " +
      "upper two thirds of the frame.\n\n" +
      "caption: engaging IG caption (hook + value + CTA, line breaks, a few " +
      "emoji). hashtags: 10-15 relevant tags without #.",
    messages: [{ role: "user", content: topic }],
    output_config: { format: zodOutputFormat(carouselDeckSchema) },
  });
  const plan = response.parsed_output;
  if (!plan || plan.slides.length === 0) throw new Error("No plan generated");

  const clean = (s: string) => (s.trim() ? s.trim() : undefined);
  const legibility = template.dark
    ? "the bottom third of the frame falls off to near-black shadow, empty and uncluttered"
    : "the bottom third of the frame stays bright, clean and empty";
  const deck = plan.slides.slice(0, slideCount).map((s) => ({
    type: s.type,
    kicker: clean(s.kicker),
    headline: clean(s.headline),
    dek: clean(s.dek),
    items: s.items.length > 0 ? s.items.slice(0, 3) : undefined,
    stat: clean(s.stat),
    statLabel: clean(s.statLabel),
    quote: clean(s.quote),
    attribution: clean(s.attribution),
    keyword: clean(s.keyword),
    keywordLabel: clean(s.keywordLabel),
    cta: clean(s.cta),
    imagePrompt:
      `${s.scene.trim().replace(/\.+$/, "")}. Style: ${template.artDirection}. ` +
      `Vertical 4:5 cinematic composition, key subject in the upper two thirds, ${legibility} ` +
      "(a text overlay goes there). Absolutely no text, no words, no letters, " +
      "no numbers, no captions, no logos, no watermarks, no typography of any kind.",
  }));

  await ctx.runMutation(internal.carousels.setDeck, {
    id: carouselId,
    caption: plan.caption,
    hashtags: plan.hashtags.map((h) => h.replace(/^#/, "")),
    deck,
  });
}

/** Classic mode: Ideogram renders the whole slide, text included. */
async function generateClassicCarousel(
  ctx: ActionCtx,
  input: {
    carouselId: Id<"carousels">;
    args: { topic: string; brand?: string; colors?: string; vibe?: string };
    slideCount: number;
  },
): Promise<void> {
  const { carouselId, args, slideCount } = input;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 8000,
    system:
      `Create an Instagram carousel with EXACTLY ${slideCount} slides. ` +
      "Slide 1 is a scroll-stopping hook; middle slides each deliver one " +
      "concrete, valuable point; the last slide is a clear CTA. Per slide: " +
      "heading ≤ 8 punchy words, body ≤ 20 words. imagePrompt must be a " +
      "COMPLETE Ideogram prompt for a 1:1 Instagram carousel slide that " +
      "RENDERS the heading and body as designed typography ON the image " +
      "(quote the exact text in the prompt), with layout direction " +
      "(heading dominant, body smaller), consistent style across all " +
      `slides${args.vibe ? ` in a ${args.vibe} vibe` : ""}` +
      `${args.colors ? `, palette: ${args.colors}` : ""}` +
      `${args.brand ? `, small '${args.brand}' watermark bottom corner` : ""}. ` +
      "caption: an engaging IG caption (hook + value + CTA, line breaks, " +
      "a few emoji). hashtags: 10-15 relevant tags without #.",
    messages: [{ role: "user", content: args.topic }],
    output_config: { format: zodOutputFormat(carouselPlanSchema) },
  });
  const plan = response.parsed_output;
  if (!plan || plan.slides.length === 0) throw new Error("No plan generated");
  const slides = plan.slides.slice(0, slideCount);
  await ctx.runMutation(internal.carousels.setPlan, {
    id: carouselId,
    caption: plan.caption,
    hashtags: plan.hashtags.map((h) => h.replace(/^#/, "")),
    slides,
  });

  const { runFal } = await import("./lib/fal");
  const { findImageModel } = await import("../lib/ai-models");
  const provider = findImageModel("ideogram-v3")!.provider;
  await Promise.all(
    slides.map(async (slide, index) => {
      const imageUrl = await runFal(provider, {
        prompt: slide.imagePrompt,
        resolution: "1024×1024",
        kind: "image",
      });
      await ctx.runMutation(internal.carousels.setSlideUrl, {
        id: carouselId,
        index,
        imageUrl,
      });
    }),
  );
}

/** Rewrite a rough idea into a strong generation prompt. */
export const enhancePrompt = action({
  args: {
    kind: v.union(v.literal("image"), v.literal("video")),
    prompt: v.string(),
  },
  handler: async (_ctx, args): Promise<string> => {
    if (!args.prompt.trim()) throw new Error("Write something first");
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("NOT_CONFIGURED: prompt enhancement needs ANTHROPIC_API_KEY.");
    }
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 600,
      system:
        `You are an expert prompt writer for AI ${args.kind} generation models. ` +
        "Rewrite the user's rough idea into one vivid, concrete prompt: " +
        "subject and action, composition, lighting, color/mood, style" +
        (args.kind === "video"
          ? ", camera movement and motion over time"
          : ", lens/framing") +
        ". Preserve the user's intent and any names, brands or text exactly. " +
        "Under 90 words. Output ONLY the prompt — no preamble, no quotes.",
      messages: [{ role: "user", content: args.prompt }],
    });
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("No suggestion generated");
    return text.text.trim();
  },
});

const callAnalysisSchema = z.object({
  summary: z.string(),
  callerName: z.string().nullable(),
  callerPhone: z.string().nullable(),
  callerEmail: z.string().nullable(),
  intent: z.string(),
  bookingMade: z.boolean(),
  bookingService: z.string().nullable(),
  bookingTime: z.string().nullable(),
  // Machine-usable start time in UTC (ISO 8601, e.g. 2026-09-08T18:00:00Z);
  // null when the stated time is too vague to pin down.
  bookingTimeIso: z.string().nullable(),
  bookingNotes: z.string().nullable(),
  followUpNeeded: z.boolean(),
  // Qualifier calls only; null for receptionist calls.
  qualified: z.boolean().nullable(),
});

/**
 * Post-call analysis: turn a raw transcript into structured booking details
 * (who called, what they wanted, what was booked). Runs automatically after
 * every completed call with a transcript.
 */
export const analyzeCall = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, args): Promise<void> => {
    if (!process.env.ANTHROPIC_API_KEY) return;
    const callDoc = await ctx.runQuery(internal.voice.getCallForAnalysis, {
      callId: args.callId,
    });
    if (!callDoc?.transcript?.trim()) return;

    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
      const client = new Anthropic();
      const response = await client.messages.parse({
        model: "claude-opus-5",
        max_tokens: 2000,
        system:
          "Analyze this phone call transcript between an AI assistant and a " +
          "caller. Extract exactly what happened: a 1–2 sentence summary, the " +
          "caller's name/phone/email if they gave them, their intent, and any " +
          "booking or appointment details (bookingMade=true only if they " +
          "actually agreed on an appointment/call/reservation; capture the " +
          "service and the date/time as stated). bookingTimeIso: resolve the " +
          "stated time to an exact ISO 8601 UTC instant. Timezone rule: if " +
          "the caller states or clearly implies a timezone or location " +
          "('Nigerian time', 'I'm in Lagos', 'London time', 'GMT+1'), resolve " +
          "in THAT timezone — it always wins; only fall back to the business " +
          "timezone provided below when the call gives no timezone signal. " +
          "Relative days like 'Tuesday' mean the NEXT such day from the " +
          "current date; null if too vague. followUpNeeded=true when the " +
          "business should call back or act. qualified is only for " +
          "lead-qualification calls: whether the lead is a good fit — null " +
          "otherwise. Use null for anything not present. Never invent details.",
        messages: [
          {
            role: "user",
            content:
              `Call type: ${callDoc.kind === "qualifier" ? "outbound lead qualification" : "inbound receptionist"}\n` +
              `Current date/time: ${new Date().toISOString()}\n` +
              `Business timezone: ${callDoc.bookingTimezone}\n\n` +
              `Transcript:\n${callDoc.transcript.slice(0, 30000)}`,
          },
        ],
        output_config: { format: zodOutputFormat(callAnalysisSchema) },
      });
      if (response.parsed_output) {
        await ctx.runMutation(internal.voice.setCallAnalysis, {
          callId: args.callId,
          analysis: response.parsed_output,
        });
        // Receptionist bookings can auto-schedule on the user's calendar.
        if (callDoc.kind === "receptionist" && response.parsed_output.bookingMade) {
          await ctx.scheduler.runAfter(0, internal.voiceActions.autoBookFromCall, {
            callId: args.callId,
          });
        }
      }
    } catch (error) {
      console.error("Call analysis failed:", error);
    }
  },
});

/** AI-suggested reply for the master inbox. */
export const suggestReply = action({
  args: { replyId: v.id("replies") },
  handler: async (ctx, args): Promise<string> => {
    const context = await ctx.runQuery(internal.outreach.getReplyContext, {
      id: args.replyId,
    });
    if (!context) throw new Error("Reply not found");
    const { reply, campaignName } = context;

    if (!process.env.ANTHROPIC_API_KEY) {
      return (
        `Hi ${reply.fromName ?? "there"},\n\n` +
        `Thanks for getting back to me — happy to share more details. ` +
        `Would a quick call this week work for you?\n\nBest regards`
      );
    }

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1000,
      system:
        "You write concise, friendly cold-email reply drafts for a business " +
        "owner. Match the prospect's tone, keep it under 120 words, aim to " +
        "book a call or answer their question. Output ONLY the reply body — " +
        "no subject line, no explanations.",
      messages: [
        {
          role: "user",
          content:
            `Campaign: ${campaignName ?? "outreach"}\n` +
            `Prospect (${reply.fromName ?? reply.leadEmail}) replied [category: ${reply.category}]:\n\n` +
            `${reply.body}\n\nDraft my reply.`,
        },
      ],
    });
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("No suggestion generated");
    return text.text.trim();
  },
});

async function parseWithClaude(queryText: string): Promise<LeadFilters> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 2000,
    system:
      "Convert the user's lead-search request into structured filters and " +
      "route it to the right source:\n" +
      "- google_maps: local/physical businesses found on Google Maps (med " +
      "spas, restaurants, dentists, gyms, plumbers, real estate OFFICES…). " +
      "Set mapsSearchString (what to type into Maps, e.g. 'med spa') and " +
      "locationQuery (e.g. 'Miami, FL, USA').\n" +
      "- realtor_agents: ONLY when the user explicitly mentions realtor.com " +
      "— extract ZIP codes into zipCodes. For realtors generally, prefer " +
      "google_maps (offices, with phones/emails) or linkedin (agents with " +
      "verified emails); realtor.com data has no contact details.\n" +
      "- linkedin: professionals by job title / people at companies — the " +
      "DEFAULT for B2B people searches (verified emails, lowest cost).\n" +
      "- explorium: ONLY when the user explicitly asks for the B2B database " +
      "or needs mobile phone numbers / company-size firmographic filters.\n" +
      "Default to google_maps for local businesses, linkedin for B2B " +
      "people searches. Use null/[] for anything not mentioned. jobTitles " +
      "are the roles searched for; keywords are other qualifying terms. " +
      "requestedCount is the number of leads the user asked for (e.g. 'get " +
      "me 100 med spas' → 100); null when no number is given.",
    messages: [{ role: "user", content: queryText }],
    output_config: { format: zodOutputFormat(filtersSchema) },
  });
  return response.parsed_output ?? parseHeuristically(queryText);
}

/** Keyword fallback so the flow works before ANTHROPIC_API_KEY is set. */
function parseHeuristically(queryText: string): LeadFilters {
  const lower = queryText.toLowerCase();
  const industries: Record<string, string> = {
    "real estate": "Real Estate",
    realtor: "Real Estate",
    restaurant: "Restaurants",
    dental: "Dental",
    dentist: "Dental",
    law: "Legal",
    lawyer: "Legal",
    plumb: "Plumbing",
    roofing: "Roofing",
    gym: "Fitness",
    fitness: "Fitness",
    marketing: "Marketing",
    ecommerce: "E-commerce",
    saas: "Software",
    software: "Software",
  };
  let industry: string | null = null;
  for (const [needle, label] of Object.entries(industries)) {
    if (lower.includes(needle)) {
      industry = label;
      break;
    }
  }
  const countries: Record<string, string> = {
    usa: "United States",
    "united states": "United States",
    "u.s": "United States",
    america: "United States",
    canada: "Canada",
    uk: "United Kingdom",
    "united kingdom": "United Kingdom",
    australia: "Australia",
  };
  let country: string | null = null;
  for (const [needle, label] of Object.entries(countries)) {
    if (lower.includes(needle)) {
      country = label;
      break;
    }
  }
  const zipCodes = queryText.match(/\b\d{5}\b/g) ?? [];
  const countMatch = queryText.match(/\b(\d{1,3})\s+(?:leads|results|businesses|people|contacts)\b/i);
  return {
    requestedCount: countMatch ? Number(countMatch[1]) : null,
    source: "google_maps" as const,
    industry,
    jobTitles: [],
    country,
    region: null,
    city: null,
    zipCodes,
    companySize: null,
    keywords: queryText.split(/\s+/).filter((w) => w.length > 3).slice(0, 5),
    mapsSearchString: industry,
    locationQuery: country,
  };
}

function generateSampleResults(filters: LeadFilters): FoundLead[] {
  const industry = filters.industry ?? "Business";
  const location =
    filters.city ?? filters.region ?? filters.country ?? "United States";
  const firstNames = ["Ava", "Liam", "Maya", "Noah", "Zoe", "Ethan", "Ivy", "Owen", "Lena", "Cole", "Nora", "Jude"];
  const lastNames = ["Carter", "Brooks", "Hayes", "Reed", "Fox", "Lane", "Wells", "Gray", "Stone", "Blake", "West", "Cross"];
  return firstNames.map((first, i) => {
    const last = lastNames[i];
    const company = `${last} ${industry} Group`;
    const slug = `${first}.${last}`.toLowerCase();
    return {
      email: `${slug}@sample-lead.example.com`,
      name: `${first} ${last}`,
      company,
      title: filters.jobTitles[0] ?? "Owner",
      location,
      industry,
      website: `https://${company.toLowerCase().replace(/[^a-z]+/g, "")}.example.com`,
      phone: `+1 555 01${String(10 + i)}`,
    };
  });
}
