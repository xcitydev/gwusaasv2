import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  getRun,
  getDatasetItems,
  mapGoogleMapsItem,
  mapLinkedinItem,
  mapRealtorItem,
} from "./lib/apify";

const POLL_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 60; // 15 minutes

/** Polls an Apify run until it finishes, then maps + stores the results. */
export const pollApifyRun = internalAction({
  args: { searchId: v.id("leadSearches"), attempts: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const search = await ctx.runQuery(internal.leadSearches.getInternal, {
      id: args.searchId,
    });
    if (!search || search.status !== "running" || !search.apifyRunId) return;

    try {
      const run = await getRun(search.apifyRunId);
      const fetchLimit = Math.min(search.limit ?? 200, 1000);
      if (run.status === "SUCCEEDED") {
        if (!run.defaultDatasetId) throw new Error("Run finished without results");
        const items = await getDatasetItems(run.defaultDatasetId, fetchLimit);
        const mapper =
          search.source === "google_maps"
            ? mapGoogleMapsItem
            : search.source === "linkedin"
              ? mapLinkedinItem
              : mapRealtorItem;
        await ctx.runMutation(internal.leadSearches.storeResults, {
          id: args.searchId,
          results: items.map(mapper),
        });
        return;
      }
      if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
        // Cost-capped/aborted runs often hold partial data — salvage it
        // rather than throwing away what was already paid for.
        if (run.status === "ABORTED" && run.defaultDatasetId) {
          const items = await getDatasetItems(run.defaultDatasetId, fetchLimit);
          if (items.length > 0) {
            const mapper =
              search.source === "google_maps"
                ? mapGoogleMapsItem
                : search.source === "linkedin"
                  ? mapLinkedinItem
                  : mapRealtorItem;
            await ctx.runMutation(internal.leadSearches.storeResults, {
              id: args.searchId,
              results: items.map(mapper),
            });
            return;
          }
        }
        await ctx.runMutation(internal.leadSearches.failSearch, {
          id: args.searchId,
          error: `The scraper run ${run.status.toLowerCase()} — check your Apify account (billing/limits) and try again.`,
        });
        return;
      }
      if (args.attempts >= MAX_ATTEMPTS) {
        await ctx.runMutation(internal.leadSearches.failSearch, {
          id: args.searchId,
          error: "Search timed out after 15 minutes. Try a narrower search.",
        });
        return;
      }
      await ctx.scheduler.runAfter(POLL_INTERVAL_MS, internal.leadProviders.pollApifyRun, {
        searchId: args.searchId,
        attempts: args.attempts + 1,
      });
    } catch (error) {
      await ctx.runMutation(internal.leadSearches.failSearch, {
        id: args.searchId,
        error: error instanceof Error ? error.message : "Scraper polling failed",
      });
    }
  },
});
