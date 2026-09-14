import {
  query,
  mutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./lib/auth";
import {
  dbToTemplate,
  findCarouselTemplate,
  type CarouselTemplate,
} from "../lib/carousel-templates";
import { findImageModel } from "../lib/ai-models";

/**
 * Admin-curated carousel templates. Built-in templates stay code-defined in
 * lib/carousel-templates.ts; these supplement them and share the token shape,
 * with the Convex doc id doubling as the template id everywhere.
 */

const templateFieldsValidator = {
  name: v.string(),
  tagline: v.string(),
  fontsUrl: v.string(),
  display: v.object({
    family: v.string(),
    weight: v.number(),
    transform: v.union(v.literal("uppercase"), v.literal("none")),
    letterSpacing: v.string(),
    sizeFactor: v.number(),
  }),
  bodyFamily: v.string(),
  monoFamily: v.string(),
  dark: v.boolean(),
  colors: v.object({
    ink: v.string(),
    surface: v.string(),
    line: v.string(),
    text: v.string(),
    muted: v.string(),
    accent: v.string(),
    accentBright: v.string(),
    accentDeep: v.string(),
    accent2: v.string(),
  }),
  artDirection: v.string(),
  bgModelId: v.string(),
  published: v.boolean(),
};

/** Published templates for the user-facing library. */
export const listPublished = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("carouselTemplates").collect();
    return all.filter((t) => t.published);
  },
});

/**
 * One template doc by id — public and published-agnostic on purpose: an old
 * carousel must keep rendering even if its template was later unpublished.
 * Takes a string and returns null on bad ids so the client can't crash it.
 */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("carouselTemplates", args.id);
    return id ? await ctx.db.get(id) : null;
  },
});

/**
 * Resolve a templateId from either source: built-ins first, then the DB.
 * Used by both the charge mutation and the generation actions.
 */
export async function resolveTemplateWithDb(
  ctx: QueryCtx | MutationCtx,
  templateId: string | undefined,
): Promise<CarouselTemplate | null> {
  if (!templateId) return null;
  const builtIn = findCarouselTemplate(templateId);
  if (builtIn) return builtIn;
  const id = ctx.db.normalizeId("carouselTemplates", templateId);
  if (!id) return null;
  const doc = await ctx.db.get(id);
  return doc ? dbToTemplate(doc) : null;
}

/** Action-side resolver (actions have no db handle). */
export const resolve = internalQuery({
  args: { templateId: v.string() },
  handler: async (ctx, args): Promise<CarouselTemplate | null> => {
    return await resolveTemplateWithDb(ctx, args.templateId);
  },
});

// ── Admin curation ──────────────────────────────────────────────────────

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("carouselTemplates").order("desc").collect();
  },
});

export const save = mutation({
  args: {
    id: v.optional(v.id("carouselTemplates")),
    ...templateFieldsValidator,
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const { id, ...fields } = args;
    if (!fields.name.trim()) throw new Error("Give the template a name");
    if (!findImageModel(fields.bgModelId)) {
      throw new Error("Unknown background model");
    }
    if (id) {
      const existing = await ctx.db.get(id);
      if (!existing) throw new Error("Template not found");
      await ctx.db.patch(id, fields);
      return id;
    }
    return await ctx.db.insert("carouselTemplates", {
      ...fields,
      createdBy: admin._id,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("carouselTemplates") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.db.delete(args.id);
  },
});
