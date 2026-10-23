import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { FoundLead } from "./lib/apify";
import { phoneLeadKey } from "../lib/lead-keys";

/**
 * Shared lead library. Every real scrape is saved here, deduped across all
 * workspaces, so a later search for the same thing (or something close) is
 * answered from storage instead of paying the scraper again. Users still pay
 * per lead when they import; contact details stay masked until then.
 */

type Filters = {
  industry?: string | null;
  jobTitles?: string[];
  country?: string | null;
  region?: string | null;
  city?: string | null;
  zipCodes?: string[];
  keywords?: string[];
  mapsSearchString?: string | null;
  locationQuery?: string | null;
};

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    // crude singular: "spas" → "spa", "realtors" → "realtor"
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));

const words = (...parts: (string | null | undefined)[]) =>
  [...new Set(parts.flatMap(norm))].sort().join(" ");

/** What a search is "about", minus where — used for keyword matching. */
export function topicTerms(source: string, f: Filters): string {
  if (source === "google_maps") {
    return words(f.mapsSearchString ?? [f.industry, ...(f.keywords ?? [])].join(" "));
  }
  if (source === "realtor_agents") return "realtor agent";
  return words(...(f.jobTitles ?? []), f.industry, ...(f.keywords ?? []));
}

/** The place a search targets, most specific first. */
function placeTerms(f: Filters): string[] {
  const place = f.city ?? f.locationQuery?.split(",")[0] ?? f.region ?? f.country;
  return norm(place);
}

/** Stable key for "the same search", whatever the wording was. */
export function poolQueryKey(source: string, f: Filters): string {
  if (source === "realtor_agents") {
    return `zips:${[...(f.zipCodes ?? [])].map((z) => z.trim()).sort().join(",")}`;
  }
  return `${topicTerms(source, f)}|${words(f.city, f.region, f.country, f.city ? null : f.locationQuery)}`;
}

export function dedupeKeyFor(lead: FoundLead): string | null {
  const email = lead.email.trim().toLowerCase();
  if (email.includes("@")) return email;
  const phone = phoneLeadKey(lead.phone);
  if (phone) return phone;
  const nameCo = words(lead.name, lead.company);
  return nameCo ? `nc:${nameCo}` : null;
}

function toFound(row: Doc<"leadPool">): FoundLead {
  return {
    email: row.email,
    name: row.name,
    company: row.company,
    title: row.title,
    location: row.location,
    industry: row.industry,
    website: row.website,
    phone: row.phone,
  };
}

/**
 * Save finished scrape results into the library and remember which leads
 * this search produced. Newer non-empty fields overwrite older ones.
 */
export async function addToPool(
  ctx: MutationCtx,
  source: string,
  filters: Filters,
  leads: FoundLead[],
  scrapedAt = Date.now(),
) {
  const now = scrapedAt;
  const ids: Id<"leadPool">[] = [];
  for (const lead of leads) {
    const dedupeKey = dedupeKeyFor(lead);
    if (!dedupeKey) continue;
    const fields = {
      email: lead.email.trim().toLowerCase(),
      name: lead.name ?? "",
      company: lead.company ?? "",
      title: lead.title ?? "",
      location: lead.location ?? "",
      industry: lead.industry ?? "",
      website: lead.website ?? "",
      phone: lead.phone ?? "",
    };
    const existing = await ctx.db
      .query("leadPool")
      .withIndex("by_source_key", (q) => q.eq("source", source).eq("dedupeKey", dedupeKey))
      .unique();
    if (existing) {
      const merged = { ...fields };
      for (const k of Object.keys(merged) as (keyof typeof merged)[]) {
        if (!merged[k]) merged[k] = existing[k];
      }
      await ctx.db.patch(existing._id, {
        ...merged,
        searchText: words(merged.name, merged.company, merged.title, merged.industry, merged.location),
        scrapedAt: Math.max(existing.scrapedAt, now),
      });
      ids.push(existing._id);
    } else {
      ids.push(
        await ctx.db.insert("leadPool", {
          source,
          dedupeKey,
          ...fields,
          searchText: words(fields.name, fields.company, fields.title, fields.industry, fields.location),
          scrapedAt: now,
        }),
      );
    }
  }
  if (ids.length === 0) return;
  const queryKey = poolQueryKey(source, filters);
  const query = await ctx.db
    .query("leadPoolQueries")
    .withIndex("by_source_query", (q) => q.eq("source", source).eq("queryKey", queryKey))
    .unique();
  if (query) {
    await ctx.db.patch(query._id, {
      leadIds: [...new Set([...ids, ...query.leadIds])].slice(0, 2000),
      scrapedAt: Math.max(query.scrapedAt, now),
    });
  } else {
    await ctx.db.insert("leadPoolQueries", { source, queryKey, leadIds: ids.slice(0, 2000), scrapedAt: now });
  }
}

/**
 * Library leads matching a search: first the leads earlier identical
 * searches produced, then keyword matches in the same place. Stale leads
 * and leads this workspace already owns are skipped.
 */
export const lookup = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    source: v.string(),
    filters: v.any(),
    limit: v.number(),
    minScrapedAt: v.number(),
  },
  handler: async (ctx, args): Promise<FoundLead[]> => {
    const filters = args.filters as Filters;
    const out: FoundLead[] = [];
    const seen = new Set<string>();
    const consider = async (row: Doc<"leadPool"> | null) => {
      if (!row || out.length >= args.limit || seen.has(row._id)) return;
      seen.add(row._id);
      if (row.scrapedAt < args.minScrapedAt) return;
      const owned = await ctx.db
        .query("leads")
        .withIndex("by_workspace_email", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("email", row.dedupeKey),
        )
        .unique();
      if (!owned) out.push(toFound(row));
    };

    const exact = await ctx.db
      .query("leadPoolQueries")
      .withIndex("by_source_query", (q) =>
        q.eq("source", args.source).eq("queryKey", poolQueryKey(args.source, filters)),
      )
      .unique();
    for (const id of exact?.leadIds ?? []) {
      if (out.length >= args.limit) break;
      await consider(await ctx.db.get(id));
    }

    // Keyword fallback ("medical spas" finds leads scraped for "med spa"),
    // restricted to the same place so a Miami search never shows Dallas.
    const topic = topicTerms(args.source, filters);
    const place = placeTerms(filters);
    if (out.length < args.limit && topic && args.source !== "realtor_agents") {
      const hits = await ctx.db
        .query("leadPool")
        .withSearchIndex("search_text", (q) =>
          q.search("searchText", [topic, ...place].join(" ")).eq("source", args.source),
        )
        .take(Math.min(1000, args.limit * 4));
      for (const row of hits) {
        if (out.length >= args.limit) break;
        const text = ` ${row.searchText} `;
        if (place.length > 0 && !place.every((w) => text.includes(` ${w} `))) continue;
        await consider(row);
      }
    }
    return out;
  },
});

/** One-off: seed the library from every real search already run. */
export const backfill = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ done: boolean; cursor: string; added: number }> => {
    const page = await ctx.db
      .query("leadSearches")
      .paginate({ cursor: args.cursor ?? null, numItems: 5 });
    let added = 0;
    for (const search of page.page) {
      if (search.sample || search.status === "failed" || !search.source) continue;
      const rows = ((search.results ?? []) as (FoundLead & { email: string })[])
        // Old rows stored "" (or a phone key) as email for email-less leads.
        .map((r) => ({ ...r, email: r.email?.includes("@lead.manual") ? "" : (r.email ?? "") }));
      await addToPool(ctx, search.source, search.filters ?? {}, rows, search._creationTime);
      added += rows.length;
    }
    return { done: page.isDone, cursor: page.continueCursor, added };
  },
});
