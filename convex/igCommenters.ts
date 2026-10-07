import {
  action,
  query,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireUser, getCurrentUser, getPrimaryWorkspace } from "./lib/auth";
import { assertPlanAction } from "./lib/plan";
import { getConfigValue } from "./config";
import { spendCredits } from "./lib/credits";
import {
  APIFY_ACTORS,
  apifyConfigured,
  getDatasetItems,
  getRun,
  igCommentsInput,
  igProfilesInput,
  mapIgCommentItem,
  mapIgProfileItem,
  startActorRun,
  type IgComment,
  type IgCommenterRow,
  type IgProfile,
} from "./lib/apify";

/**
 * Leads → IG Commenters. One job = two Apify runs chained by a scheduled
 * poller: apify/instagram-comment-scraper (post → comments, deduped by
 * author) then apify/instagram-profile-scraper (authors → bio, followers,
 * link in bio). Credits are charged on completion, per profile returned.
 */

const MAX_LIMIT = 500;
const POLL_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 40; // 10 minutes per stage
const POST_URL = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;

function normalizePostUrl(raw: string): string {
  const match = POST_URL.exec(raw.trim());
  if (!match) {
    throw new Error("Paste an Instagram post or reel link (instagram.com/p/… or /reel/…).");
  }
  const kind = match[2].toLowerCase() === "reels" ? "reel" : match[2].toLowerCase();
  return `https://www.instagram.com/${kind}/${match[3]}/`;
}

function emptyProfile(username: string): IgProfile {
  return {
    username,
    fullName: "",
    biography: "",
    followersCount: 0,
    followsCount: 0,
    postsCount: 0,
    externalUrl: "",
    verified: false,
    isPrivate: false,
    isBusinessAccount: false,
    businessCategoryName: "",
    profilePicUrl: "",
  };
}

/** Unit rates (×4.5 rule, admin-tunable) + whether Apify is wired up. */
export const pricing = query({
  args: {},
  handler: async (ctx) => {
    const rates = await creditRates(ctx);
    return { ...rates, perCommenter: rates.comment + rates.profile, configured: apifyConfigured() };
  },
});

async function creditRates(ctx: { db: unknown }): Promise<{ comment: number; profile: number }> {
  const c = ctx as Parameters<typeof getConfigValue>[0];
  return {
    comment: Math.max(0, Number(await getConfigValue(c, "igCommentCreditsEach")) || 0),
    profile: Math.max(0, Number(await getConfigValue(c, "igProfileCreditsEach")) || 0),
  };
}

/** Credits for a job: comments scraped × rate + profiles found × rate, rounded up. */
export function jobCredits(rates: { comment: number; profile: number }, comments: number, profiles: number): number {
  return Math.ceil(comments * rates.comment + profiles * rates.profile);
}

export const start = action({
  args: { postUrl: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ jobId: Id<"igCommentScrapes"> }> => {
    await assertPlanAction(ctx, "personal", "Scrape Leads");
    const postUrl = normalizePostUrl(args.postUrl);
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.round(args.limit ?? 100)));
    if (!apifyConfigured()) {
      throw new Error("NOT_CONFIGURED: APIFY_API_TOKEN is not set on the Convex deployment");
    }
    const jobId: Id<"igCommentScrapes"> = await ctx.runMutation(
      internal.igCommenters.createJob,
      { postUrl, limit },
    );
    try {
      // ~$0.0026 per comment on Apify's pay-per-result plan; the ceiling
      // leaves ~2× headroom so a run can't run away.
      const runId = await startActorRun(
        APIFY_ACTORS.ig_comments,
        igCommentsInput({ postUrl, limit }),
        Math.max(1, Math.ceil(limit * 0.005)),
      );
      await ctx.runMutation(internal.igCommenters.setRun, {
        id: jobId,
        apifyRunId: runId,
        step: "comments",
      });
      await ctx.scheduler.runAfter(10_000, internal.igCommenters.poll, {
        jobId,
        attempts: 0,
      });
    } catch (error) {
      await ctx.runMutation(internal.igCommenters.fail, {
        id: jobId,
        error: error instanceof Error ? error.message : "Couldn't start the scraper",
      });
      throw error;
    }
    return { jobId };
  },
});

export const createJob = internalMutation({
  args: { postUrl: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const rates = await creditRates(ctx);
    // Billed on completion from actual counts; require the worst case (every
    // comment scraped and every profile found) up front so a finished run can
    // never be left unpaid.
    if (workspace.credits < jobCredits(rates, args.limit, args.limit)) {
      throw new Error("INSUFFICIENT_CREDITS");
    }
    return await ctx.db.insert("igCommentScrapes", {
      workspaceId: workspace._id,
      userId: user._id,
      postUrl: args.postUrl,
      limit: args.limit,
      status: "running",
      step: "comments",
      resultCount: 0,
      creditCostPerProfile: rates.comment + rates.profile,
      creditRates: rates,
    });
  },
});

export const setRun = internalMutation({
  args: {
    id: v.id("igCommentScrapes"),
    apifyRunId: v.string(),
    step: v.union(v.literal("comments"), v.literal("profiles")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { apifyRunId: args.apifyRunId, step: args.step });
  },
});

export const setComments = internalMutation({
  args: { id: v.id("igCommentScrapes"), comments: v.any(), commentCount: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { comments: args.comments, commentCount: args.commentCount });
  },
});

export const fail = internalMutation({
  args: { id: v.id("igCommentScrapes"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "failed", error: args.error });
  },
});

/**
 * Store the merged rows and bill the job under the ×4.5 rule: every comment
 * Apify scraped for us × comment rate + every profile it returned × profile
 * rate, rounded up. Commenters without a reachable profile cost us only the
 * comment, so that is all they're billed for.
 */
export const complete = internalMutation({
  args: { id: v.id("igCommentScrapes"), rows: v.any(), warning: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job || job.status !== "running") return;
    const rows = (args.rows as IgCommenterRow[]).slice(0, job.limit);
    const profilesFound = rows.filter((r) => !r.profileMissing).length;
    const rates = job.creditRates ?? { comment: 0, profile: job.creditCostPerProfile };
    const commentsScraped = Math.max(job.commentCount ?? rows.length, rows.length);
    const due = jobCredits(rates, commentsScraped, profilesFound);
    let creditsSpent = 0;
    let warning = args.warning;
    if (due > 0) {
      const workspace = await ctx.db.get(job.workspaceId);
      const balance = workspace?.credits ?? 0;
      // The worst case was reserved at start; this only triggers if the
      // balance dropped mid-run. Charge what's there and say so.
      const charge = Math.min(due, Math.floor(balance));
      if (charge < due) {
        warning = [
          warning,
          `This run cost ${due} credits but your balance only covered ${charge} — please top up.`,
        ]
          .filter(Boolean)
          .join(" ");
      }
      if (charge > 0) {
        creditsSpent = charge;
        await spendCredits(ctx, {
          workspaceId: job.workspaceId,
          amount: charge,
          feature: "ig_commenters",
          description: `IG commenters: ${commentsScraped} comment${commentsScraped === 1 ? "" : "s"}, ${profilesFound} profile${profilesFound === 1 ? "" : "s"}`,
          userId: job.userId,
          meta: { jobId: args.id, rates, commentsScraped, profilesFound, due, postUrl: job.postUrl },
        });
      }
    }
    await ctx.db.patch(args.id, {
      status: "done",
      results: rows,
      resultCount: rows.length,
      creditsSpent,
      // Stage-1 payload is folded into the rows; drop it to keep the doc small.
      comments: undefined,
      ...(warning && { warning }),
    });
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("igCommentScrapes") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

/** Polls the current Apify run; stage 1 hands off to stage 2, stage 2 completes the job. */
export const poll = internalAction({
  args: { jobId: v.id("igCommentScrapes"), attempts: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.runQuery(internal.igCommenters.getInternal, { id: args.jobId });
    if (!job || job.status !== "running" || !job.apifyRunId) return;

    const failWith = (error: string) =>
      ctx.runMutation(internal.igCommenters.fail, { id: args.jobId, error });

    try {
      const run = await getRun(job.apifyRunId);
      const terminal = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status);
      if (!terminal) {
        if (args.attempts >= MAX_ATTEMPTS) {
          await failWith(
            job.step === "comments"
              ? "Scraping the comments timed out. Try a lower comment count."
              : "Pulling the profiles timed out. Try a lower comment count.",
          );
          return;
        }
        await ctx.scheduler.runAfter(POLL_INTERVAL_MS, internal.igCommenters.poll, {
          jobId: args.jobId,
          attempts: args.attempts + 1,
        });
        return;
      }

      // Cost-capped / timed-out runs usually hold partial data — salvage it.
      const partial = run.status !== "SUCCEEDED";
      if (partial && run.status === "FAILED") {
        await failWith(
          "The scraper run failed — check the Apify account (billing/limits) and try again.",
        );
        return;
      }
      if (!run.defaultDatasetId) {
        await failWith("The scraper finished without any results.");
        return;
      }
      const items = await getDatasetItems(run.defaultDatasetId, Math.min(job.limit * 2, 1000));

      if (job.step === "comments") {
        const byUser = new Map<string, IgComment>();
        for (const item of items) {
          const comment = mapIgCommentItem(item);
          if (!comment) continue;
          const key = comment.username.toLowerCase();
          const prev = byUser.get(key);
          if (prev) {
            prev.commentCount += 1;
            if (!prev.text && comment.text) prev.text = comment.text;
          } else {
            byUser.set(key, comment);
          }
        }
        const comments = [...byUser.values()].slice(0, job.limit);
        if (comments.length === 0) {
          await failWith("No comments found — is the post public, and does it have comments?");
          return;
        }
        await ctx.runMutation(internal.igCommenters.setComments, {
          id: args.jobId,
          comments,
          commentCount: items.length,
        });
        // ~$0.0016 per profile; same ~2× headroom.
        const usernames = comments.map((c) => c.username);
        const runId = await startActorRun(
          APIFY_ACTORS.ig_profiles,
          igProfilesInput({ usernames }),
          Math.max(1, Math.ceil(usernames.length * 0.004)),
        );
        await ctx.runMutation(internal.igCommenters.setRun, {
          id: args.jobId,
          apifyRunId: runId,
          step: "profiles",
        });
        await ctx.scheduler.runAfter(10_000, internal.igCommenters.poll, {
          jobId: args.jobId,
          attempts: 0,
        });
        return;
      }

      // Stage 2: merge bios onto the commenters.
      const profiles = new Map<string, IgProfile>();
      for (const item of items) {
        const profile = mapIgProfileItem(item);
        if (profile) profiles.set(profile.username.toLowerCase(), profile);
      }
      const comments = (job.comments ?? []) as IgComment[];
      const rows: IgCommenterRow[] = comments.map((c) => {
        const profile = profiles.get(c.username.toLowerCase());
        return {
          ...(profile ?? { ...emptyProfile(c.username), profilePicUrl: c.profilePicUrl }),
          profileUrl: `https://www.instagram.com/${c.username}/`,
          comment: c.text,
          commentLikes: c.likes,
          commentAt: c.timestamp,
          commentCount: c.commentCount,
          profileMissing: !profile,
        };
      });
      const missing = rows.filter((r) => r.profileMissing).length;
      const warning = [
        partial ? `The profile run ${run.status.toLowerCase()} early — showing what was retrieved.` : "",
        missing > 0
          ? `${missing} commenter${missing === 1 ? "" : "s"} had no reachable profile (private, deleted or rate-limited) — listed without a bio and not charged.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      await ctx.runMutation(internal.igCommenters.complete, {
        id: args.jobId,
        rows,
        ...(warning && { warning }),
      });
    } catch (error) {
      await failWith(error instanceof Error ? error.message : "Scraper polling failed");
    }
  },
});

/** Live job state for the UI (reactive). */
export const get = query({
  args: { id: v.id("igCommentScrapes") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    const job = await ctx.db.get(args.id);
    if (!job || !workspace || job.workspaceId !== workspace._id) return null;
    return job;
  },
});

/** The workspace's last 10 scrapes, without their payloads. */
export const recent = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    const jobs = await ctx.db
      .query("igCommentScrapes")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(10);
    return jobs.map((j) => ({
      _id: j._id,
      _creationTime: j._creationTime,
      postUrl: j.postUrl,
      status: j.status,
      resultCount: j.resultCount,
    }));
  },
});
