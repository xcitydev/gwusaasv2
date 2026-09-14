import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireUser, getCurrentUser, getPrimaryWorkspace } from "./lib/auth";
import { getConfigValue, ConfigKey } from "./config";
import { spendCredits } from "./lib/credits";
import { leadSourceMeta } from "../lib/lead-sources";
import type { FoundLead } from "./lib/apify";

export type SearchResultRow = FoundLead & { duplicate: boolean; noEmail: boolean };

export const createSearch = internalMutation({
  args: {
    query: v.string(),
    filters: v.any(),
    source: v.string(),
    sample: v.boolean(),
    apifyRunId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const costTier = leadSourceMeta(args.source).costTier;
    const creditCostPerLead = await getConfigValue(ctx, costTier as ConfigKey);
    return await ctx.db.insert("leadSearches", {
      workspaceId: workspace._id,
      userId: user._id,
      query: args.query,
      filters: args.filters,
      source: args.source,
      status: "running",
      sample: args.sample,
      apifyRunId: args.apifyRunId,
      resultCount: 0,
      creditCostPerLead: Number(creditCostPerLead) || 1,
      limit: args.limit,
    });
  },
});

/** Store finished results, marking duplicates + rows without emails. */
export const storeResults = internalMutation({
  args: {
    id: v.id("leadSearches"),
    results: v.any(),
    warning: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.id);
    if (!search) return;
    // Row storage ceiling: 1000 keeps the doc well inside Convex's 1MB limit.
    const raw = (args.results as FoundLead[]).slice(
      0,
      Math.min(search.limit ?? 200, 1000),
    );
    const rows: SearchResultRow[] = [];
    const seen = new Set<string>();
    for (const lead of raw) {
      const email = lead.email.trim().toLowerCase();
      const noEmail = !email.includes("@");
      let duplicate = false;
      if (!noEmail) {
        if (seen.has(email)) continue; // collapse in-batch dupes entirely
        seen.add(email);
        duplicate = Boolean(
          await ctx.db
            .query("leads")
            .withIndex("by_workspace_email", (q) =>
              q.eq("workspaceId", search.workspaceId).eq("email", email),
            )
            .unique(),
        );
      }
      rows.push({ ...lead, email, duplicate, noEmail });
    }
    await ctx.db.patch(args.id, {
      status: "done",
      results: rows,
      resultCount: rows.length,
      ...(args.warning && { warning: args.warning }),
    });
  },
});

export const failSearch = internalMutation({
  args: { id: v.id("leadSearches"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "failed", error: args.error });
  },
});

export const setRunId = internalMutation({
  args: { id: v.id("leadSearches"), apifyRunId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { apifyRunId: args.apifyRunId });
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("leadSearches") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Live search state for the UI (reactive — updates as the job progresses). */
export const get = query({
  args: { id: v.id("leadSearches") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const search = await ctx.db.get(args.id);
    if (!search || !workspace || search.workspaceId !== workspace._id) return null;
    return search;
  },
});

/**
 * Import selected rows from a finished search. Charged at the search's
 * per-source credit cost; duplicates and email-less rows are never imported
 * or charged.
 */
export const importFromSearch = mutation({
  args: { id: v.id("leadSearches"), emails: v.array(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const search = await ctx.db.get(args.id);
    if (!search || search.workspaceId !== workspace._id) throw new Error("Search not found");
    const rows = (search.results ?? []) as SearchResultRow[];
    const wanted = new Set(args.emails.map((e) => e.trim().toLowerCase()));

    const importable: SearchResultRow[] = [];
    let skipped = 0;
    for (const row of rows) {
      if (!wanted.has(row.email)) continue;
      if (row.noEmail) continue;
      const existing = await ctx.db
        .query("leads")
        .withIndex("by_workspace_email", (q) =>
          q.eq("workspaceId", workspace._id).eq("email", row.email),
        )
        .unique();
      if (existing) {
        skipped++;
        continue;
      }
      importable.push(row);
    }

    const costPerLead = search.creditCostPerLead ?? 1;
    const creditsSpent = importable.length * costPerLead;
    if (importable.length > 0 && !search.sample) {
      await spendCredits(ctx, {
        workspaceId: workspace._id,
        amount: creditsSpent,
        feature: "lead_import",
        description: `${importable.length} leads from ${leadSourceMeta(search.source).label}`,
        userId: user._id,
        meta: { searchId: args.id, costPerLead },
      });
    }
    for (const row of importable) {
      await ctx.db.insert("leads", {
        workspaceId: workspace._id,
        email: row.email,
        name: row.name || undefined,
        company: row.company || undefined,
        title: row.title || undefined,
        phone: row.phone || undefined,
        location: row.location || undefined,
        industry: row.industry || undefined,
        website: row.website || undefined,
        source: search.source ?? "search",
        sourceDetail: search.query,
      });
    }
    return {
      imported: importable.length,
      skipped,
      creditsSpent: search.sample ? 0 : creditsSpent,
    };
  },
});
