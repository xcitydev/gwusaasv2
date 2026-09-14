import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { grantCredits, spendCredits } from "./lib/credits";
import { getConfigValue } from "./config";
import { costInCredits } from "../lib/ai-models";
import { resolveTemplateWithDb } from "./carouselTemplates";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    return await ctx.db
      .query("carousels")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(50);
  },
});

/** Charge for all slides up front and create the running record. */
export const start = internalMutation({
  args: {
    topic: v.string(),
    brand: v.optional(v.string()),
    vibe: v.optional(v.string()),
    templateId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    slideCount: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const [markup, creditPriceUsd] = await Promise.all([
      getConfigValue(ctx, "generationMarkup"),
      getConfigValue(ctx, "creditPriceUsd"),
    ]);
    const perSlide = costInCredits({
      kind: "image",
      modelId: args.modelId ?? "ideogram-v3",
      markup,
      creditPriceUsd,
    });
    const costCredits = perSlide * args.slideCount;
    await spendCredits(ctx, {
      workspaceId: workspace._id,
      amount: costCredits,
      feature: "carousel",
      description: `IG carousel — ${args.slideCount} slides`,
      userId: user._id,
    });
    const carouselId = await ctx.db.insert("carousels", {
      workspaceId: workspace._id,
      userId: user._id,
      topic: args.topic,
      brand: args.brand,
      vibe: args.vibe,
      templateId: args.templateId,
      status: "running",
      costCredits,
    });
    return { carouselId, costCredits };
  },
});

/** Claude's slide plan lands first so the UI shows copy while images render. */
export const setPlan = internalMutation({
  args: {
    id: v.id("carousels"),
    caption: v.string(),
    hashtags: v.array(v.string()),
    slides: v.array(
      v.object({ heading: v.string(), body: v.string(), imagePrompt: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      caption: args.caption,
      hashtags: args.hashtags,
      slides: args.slides,
    });
  },
});

export const get = internalQuery({
  args: { id: v.id("carousels") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

/**
 * Template mode step 1: create the draft — Claude writes the deck for free,
 * nothing is charged until the user approves and renders backgrounds.
 */
export const startDraft = internalMutation({
  args: {
    topic: v.string(),
    brand: v.optional(v.string()),
    templateId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    return await ctx.db.insert("carousels", {
      workspaceId: workspace._id,
      userId: user._id,
      topic: args.topic,
      brand: args.brand,
      templateId: args.templateId,
      status: "draft",
      costCredits: 0,
    });
  },
});

/**
 * Template mode step 2: user approved the plan — charge for the backgrounds
 * and flip to running. Throws INSUFFICIENT_CREDITS via spendCredits.
 */
export const chargeAndRun = internalMutation({
  args: { id: v.id("carousels") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const carousel = await ctx.db.get(args.id);
    if (!carousel || carousel.workspaceId !== workspace._id) {
      throw new Error("Carousel not found");
    }
    if (carousel.status !== "draft") throw new Error("Already rendered");
    if (!carousel.deck || carousel.deck.length === 0) {
      throw new Error("No slide plan yet");
    }
    const template = await resolveTemplateWithDb(ctx, carousel.templateId);
    if (!template) throw new Error("Unknown template");
    const [markup, creditPriceUsd] = await Promise.all([
      getConfigValue(ctx, "generationMarkup"),
      getConfigValue(ctx, "creditPriceUsd"),
    ]);
    const perSlide = costInCredits({
      kind: "image",
      modelId: template.bgModelId,
      markup,
      creditPriceUsd,
    });
    const costCredits = perSlide * carousel.deck.length;
    await spendCredits(ctx, {
      workspaceId: workspace._id,
      amount: costCredits,
      feature: "carousel",
      description: `IG carousel backgrounds — ${carousel.deck.length} slides`,
      userId: user._id,
    });
    await ctx.db.patch(args.id, { status: "running", costCredits });
    return { costCredits };
  },
});

/**
 * Persist in-place text edits from the slide preview (draft or done).
 * Copy fields only — never the image prompt or background URL.
 */
export const updateDeckSlide = mutation({
  args: {
    id: v.id("carousels"),
    index: v.number(),
    fields: v.object({
      kicker: v.optional(v.string()),
      headline: v.optional(v.string()),
      dek: v.optional(v.string()),
      items: v.optional(
        v.array(v.object({ title: v.string(), body: v.string() })),
      ),
      stat: v.optional(v.string()),
      statLabel: v.optional(v.string()),
      quote: v.optional(v.string()),
      attribution: v.optional(v.string()),
      keyword: v.optional(v.string()),
      keywordLabel: v.optional(v.string()),
      cta: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const carousel = await ctx.db.get(args.id);
    if (!carousel || carousel.workspaceId !== workspace._id) {
      throw new Error("Carousel not found");
    }
    if (!carousel.deck?.[args.index]) return;
    const deck = [...carousel.deck];
    deck[args.index] = { ...deck[args.index], ...args.fields };
    await ctx.db.patch(args.id, { deck });
  },
});

const deckSlideValidator = v.object({
  type: v.string(),
  kicker: v.optional(v.string()),
  headline: v.optional(v.string()),
  dek: v.optional(v.string()),
  items: v.optional(v.array(v.object({ title: v.string(), body: v.string() }))),
  stat: v.optional(v.string()),
  statLabel: v.optional(v.string()),
  quote: v.optional(v.string()),
  attribution: v.optional(v.string()),
  keyword: v.optional(v.string()),
  keywordLabel: v.optional(v.string()),
  cta: v.optional(v.string()),
  imagePrompt: v.string(),
  bgUrl: v.optional(v.string()),
});

/** Template-mode plan: structured deck copy lands before backgrounds render. */
export const setDeck = internalMutation({
  args: {
    id: v.id("carousels"),
    caption: v.string(),
    hashtags: v.array(v.string()),
    deck: v.array(deckSlideValidator),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      caption: args.caption,
      hashtags: args.hashtags,
      deck: args.deck,
    });
  },
});

export const setDeckSlideUrl = internalMutation({
  args: { id: v.id("carousels"), index: v.number(), bgUrl: v.string() },
  handler: async (ctx, args) => {
    const carousel = await ctx.db.get(args.id);
    if (!carousel?.deck?.[args.index]) return;
    const deck = [...carousel.deck];
    deck[args.index] = { ...deck[args.index], bgUrl: args.bgUrl };
    await ctx.db.patch(args.id, { deck });
  },
});

export const setSlideUrl = internalMutation({
  args: { id: v.id("carousels"), index: v.number(), imageUrl: v.string() },
  handler: async (ctx, args) => {
    const carousel = await ctx.db.get(args.id);
    if (!carousel?.slides?.[args.index]) return;
    const slides = [...carousel.slides];
    slides[args.index] = { ...slides[args.index], imageUrl: args.imageUrl };
    await ctx.db.patch(args.id, { slides });
  },
});

export const finish = internalMutation({
  args: {
    id: v.id("carousels"),
    status: v.union(v.literal("done"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const carousel = await ctx.db.get(args.id);
    if (!carousel) return;
    await ctx.db.patch(args.id, { status: args.status, error: args.error });
    if (args.status === "failed" && carousel.costCredits > 0) {
      await grantCredits(ctx, {
        workspaceId: carousel.workspaceId,
        amount: carousel.costCredits,
        feature: "carousel",
        description: "Refund — carousel generation failed",
      });
    }
  },
});
