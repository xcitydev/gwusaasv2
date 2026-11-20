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
      // Runs are sized above the request (see scrapeSize in ai.ts) so repeats
      // and already-owned leads can be skipped; read everything the run found.
      const fetchLimit = 1000;
      if (run.status === "SUCCEEDED") {
        if (!run.defaultDatasetId) throw new Error(`Apify run ${search.apifyRunId} finished without a dataset`);
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
          // Mentions the vendor so it is hidden from the user and filed for admins.
          error: `Apify run ${search.apifyRunId} still not finished after 15 minutes — search timed out`,
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
        error: `Apify polling failed for run ${search.apifyRunId}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
});
