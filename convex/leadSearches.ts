import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { publicRowError } from "./incidents";
import { v } from "convex/values";
import { requireUser, getCurrentUser, getPrimaryWorkspace } from "./lib/auth";
import { getConfigValue, ConfigKey } from "./config";
import { spendCredits } from "./lib/credits";
import { leadSourceMeta } from "../lib/lead-sources";
import { phoneLeadKey } from "../lib/lead-keys";
import { addToPool } from "./leadPool";
import type { FoundLead } from "./lib/apify";

export type SearchResultRow = FoundLead & {
  /** Opaque id the client selects by — never the email (that stays hidden). */
  rowId?: string;
  duplicate: boolean;
  noEmail: boolean;
  /** No email, but a phone — importable; `email` holds the phone-derived key. */
  phoneOnly?: boolean;
  /** Came from the shared library, not this search's own scrape. */
  fromPool?: boolean;
};

/** A search that has been "running" longer than this is treated as stuck. */
const STUCK_AFTER_MS = 20 * 60 * 1000;

/** Legacy rows predate rowId; their array position is stable (never merged). */
const rowIdOf = (row: SearchResultRow, i: number) => row.rowId ?? `i${i}`;

/**
 * Everything the search action needs before it spends anything: the
 * caller's workspace, its balance, this source's price, and whether another
 * search is still running (one at a time per workspace).
 */
export const prepare = internalQuery({
  args: { source: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const costTier = leadSourceMeta(args.source).costTier;
    const costPerLead = Number(await getConfigValue(ctx, costTier as ConfigKey)) || 1;
    const recent = await ctx.db
      .query("leadSearches")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(10);
    const now = Date.now();
    const running = recent.some(
      (s) => s.status === "running" && now - s._creationTime < STUCK_AFTER_MS,
    );
    return { workspaceId: workspace._id, credits: workspace.credits, costPerLead, running };
  },
});

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

/**
 * Store results, marking duplicates + rows without emails. A fresh scrape
 * is also saved to the shared library. When a "Find more" scrape finishes,
 * its rows are appended to the library rows already shown.
 */
export const storeResults = internalMutation({
  args: {
    id: v.id("leadSearches"),
    results: v.any(),
    warning: v.optional(v.string()),
    /** Rows came from the library (no scrape ran). */
    fromPool: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.id);
    if (!search) return;
    const incoming = args.results as FoundLead[];
    if (!search.sample && !args.fromPool && search.source && incoming.length > 0) {
      await addToPool(ctx, search.source, search.filters ?? {}, incoming);
    }

    // Row storage ceiling: 1000 keeps the doc well inside Convex's 1MB limit.
    const cap = Math.min(search.limit ?? 200, 1000);
    const kept = search.extending ? ((search.results ?? []) as SearchResultRow[]) : [];
    const rows: SearchResultRow[] = [...kept];
    const seen = new Set(kept.map((r) => r.email).filter(Boolean));
    let nextId = kept.length;
    for (const lead of incoming) {
      if (rows.length >= cap) break;
      const realEmail = (lead.email ?? "").trim().toLowerCase();
      const noEmail = !realEmail.includes("@");
      // No email but a phone → still importable (the user decides), keyed by
      // the phone digits. Neither → nothing to contact, never importable.
      const phoneKey = noEmail ? phoneLeadKey(lead.phone) : null;
      const email = noEmail ? (phoneKey ?? "") : realEmail;
      let duplicate = false;
      if (email) {
        if (seen.has(email)) continue; // collapse dupes entirely
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
      rows.push({
        ...lead,
        email,
        rowId: `r${nextId++}`,
        duplicate,
        noEmail,
        phoneOnly: Boolean(phoneKey),
        ...(args.fromPool && { fromPool: true }),
      });
    }
    await ctx.db.patch(args.id, {
      status: "done",
      extending: false,
      results: rows,
      resultCount: rows.length,
      ...(args.fromPool && { poolCount: rows.length }),
      ...(args.warning && {
        warning: await publicRowError(ctx, args.warning, {
          source: `lead search warning (${search.source ?? "unknown"})`,
          area: "leads",
          userId: search.userId,
          workspaceId: search.workspaceId,
        }),
      }),
    });
  },
});

export const failSearch = internalMutation({
  args: { id: v.id("leadSearches"), error: v.string() },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.id);
    const error = await publicRowError(ctx, args.error, {
      source: `lead search (${search?.source ?? "unknown"})`,
      area: "leads",
      userId: search?.userId,
      workspaceId: search?.workspaceId,
    });
    // A failed "Find more" must not wipe the library results already shown.
    if (search?.extending && (search.results ?? []).length > 0) {
      await ctx.db.patch(args.id, {
        status: "done",
        extending: false,
        warning: `Couldn't find more leads: ${error}`,
      });
      return;
    }
    await ctx.db.patch(args.id, { status: "failed", error });
  },
});

/** Flip a finished library search back to running for a "Find more" scrape. */
export const startExtend = internalMutation({
  args: { id: v.id("leadSearches") },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.id);
    if (!search) throw new Error("Search not found");
    await ctx.db.patch(args.id, { status: "running", extending: true, warning: undefined });
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

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "";
  return `${local.slice(0, 1)}•••@${domain}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return phone ? "•••" : "";
  return `•••-•••-••${digits.slice(-2)}`;
}

/**
 * Live search state for the UI (reactive — updates as the job progresses).
 * Contact details are masked HERE, server-side, until the workspace owns
 * the lead — so nobody can read them off the page and skip paying.
 */
export const get = query({
  args: { id: v.id("leadSearches") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const search = await ctx.db.get(args.id);
    if (!search || !workspace || search.workspaceId !== workspace._id) return null;
    const rows = (search.results ?? []) as SearchResultRow[];
    const results = await Promise.all(
      rows.map(async (row, i) => {
        const owned = row.email
          ? Boolean(
              await ctx.db
                .query("leads")
                .withIndex("by_workspace_email", (q) =>
                  q.eq("workspaceId", workspace._id).eq("email", row.email),
                )
                .unique(),
            )
          : false;
        const realEmail = row.noEmail ? "" : row.email;
        return {
          rowId: rowIdOf(row, i),
          name: row.name,
          company: row.company,
          title: row.title,
          location: row.location,
          industry: row.industry,
          website: row.website,
          email: owned ? realEmail : maskEmail(realEmail),
          phone: owned ? row.phone : maskPhone(row.phone ?? ""),
          duplicate: owned,
          noEmail: row.noEmail,
          phoneOnly: Boolean(row.phoneOnly),
          fromPool: Boolean(row.fromPool),
        };
      }),
    );
    const limit = search.limit ?? 200;
    return {
      ...search,
      results,
      // Library-only results short of what was asked → offer a real scrape.
      canFindMore:
        !search.sample &&
        search.status === "done" &&
        (search.poolCount ?? 0) > 0 &&
        (search.poolCount ?? 0) === rows.length &&
        rows.length < limit,
    };
  },
});

/**
 * Import selected rows from a finished search. Charged at the search's
 * per-source credit cost; duplicates and rows with neither an email nor a
 * phone are never imported or charged. Phone-only rows import like any other.
 */
export const importFromSearch = mutation({
  args: { id: v.id("leadSearches"), rowIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const search = await ctx.db.get(args.id);
    if (!search || search.workspaceId !== workspace._id) throw new Error("Search not found");
    if (search.status === "running") throw new Error("Wait for the search to finish first.");
    const rows = (search.results ?? []) as SearchResultRow[];
    const wanted = new Set(args.rowIds);

    const importable: SearchResultRow[] = [];
    let skipped = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.email || !wanted.has(rowIdOf(row, i))) continue;
      if (row.noEmail && !row.phoneOnly) continue;
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
