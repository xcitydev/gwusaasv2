import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";
import { spendCredits } from "./lib/credits";

const leadInput = v.object({
  email: v.string(),
  name: v.optional(v.string()),
  company: v.optional(v.string()),
  title: v.optional(v.string()),
  phone: v.optional(v.string()),
  location: v.optional(v.string()),
  industry: v.optional(v.string()),
  website: v.optional(v.string()),
  extra: v.optional(v.any()),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    return await ctx.db
      .query("leads")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(1000);
  },
});

/**
 * Import leads with per-workspace dedupe by email. Found leads (from search
 * providers) cost 1 credit each; the user's own CSV imports are free.
 * Duplicates are skipped and never charged.
 */
export const importLeads = mutation({
  args: {
    leads: v.array(leadInput),
    source: v.string(),
    chargeCredits: v.boolean(),
    // e.g. "Campaign: Q1 Realtors" or a search query — shown in My Leads.
    sourceDetail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");

    // Dedupe within the batch and against existing leads first, so we only
    // charge for what's actually new.
    const seen = new Set<string>();
    const fresh: typeof args.leads = [];
    let skipped = 0;
    for (const lead of args.leads) {
      const email = lead.email.trim().toLowerCase();
      if (!email || !email.includes("@")) {
        skipped++;
        continue;
      }
      if (seen.has(email)) {
        skipped++;
        continue;
      }
      seen.add(email);
      const existing = await ctx.db
        .query("leads")
        .withIndex("by_workspace_email", (q) =>
          q.eq("workspaceId", workspace._id).eq("email", email),
        )
        .unique();
      if (existing) {
        skipped++;
        continue;
      }
      fresh.push({ ...lead, email });
    }

    if (fresh.length > 0 && args.chargeCredits) {
      await spendCredits(ctx, {
        workspaceId: workspace._id,
        amount: fresh.length,
        feature: "lead_import",
        description: `Imported ${fresh.length} leads from ${args.source}`,
        userId: user._id,
      });
    }

    const importedIds = [];
    for (const lead of fresh) {
      importedIds.push(
        await ctx.db.insert("leads", {
          workspaceId: workspace._id,
          source: args.source,
          sourceDetail: args.sourceDetail,
          ...lead,
        }),
      );
    }

    return { imported: fresh.length, skipped, importedIds };
  },
});

export const removeLeads = mutation({
  args: { ids: v.array(v.id("leads")) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    for (const id of args.ids) {
      const lead = await ctx.db.get(id);
      if (lead && lead.workspaceId === workspace._id) {
        await ctx.db.delete(id);
      }
    }
  },
});

export const recordSearch = internalMutation({
  args: { query: v.string(), filters: v.any(), resultCount: v.number() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return;
    await ctx.db.insert("leadSearches", {
      workspaceId: workspace._id,
      userId: user._id,
      query: args.query,
      filters: args.filters,
      resultCount: args.resultCount,
    });
  },
});
