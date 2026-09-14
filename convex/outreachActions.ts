import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { decryptString, encryptString } from "./lib/crypto";
import { toInstantlyTags } from "../lib/merge-tags";
import { toEngineTimezone } from "../lib/timezones";
import {
  instantlyConfigured,
  createAccount,
  enableWarmup,
  pauseWarmup,
  listAccounts,
  getWarmupAnalytics,
  createCampaign,
  updateCampaign as updateEngineCampaign,
  addLeadsToCampaign,
  activateCampaign,
  pauseCampaign,
  getCampaignAnalytics,
  listReplyEmails,
  replyToEmail,
} from "./lib/instantly";

/** Instantly's duplicate-account wording varies — match all known forms. */
function isAlreadyRegistered(message: string): boolean {
  return /already (exist|been added)|duplicate/i.test(message);
}

/**
 * Inbox connection: encrypts IMAP/SMTP credentials, stores locally, and —
 * when Instantly is connected — registers each account for sending + warmup.
 */
export const connectInboxes = action({
  args: {
    inboxes: v.array(
      v.object({
        email: v.string(),
        provider: v.union(
          v.literal("google"),
          v.literal("outlook"),
          v.literal("imap_smtp"),
          v.literal("prewarmed"),
        ),
        dailyLimit: v.number(),
        imap: v.optional(
          v.object({
            host: v.string(),
            port: v.string(),
            username: v.string(),
            password: v.string(),
          }),
        ),
        smtp: v.optional(
          v.object({
            host: v.string(),
            port: v.string(),
            username: v.string(),
            password: v.string(),
          }),
        ),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ added: number; skipped: number; engineErrors: string[] }> => {
    const prepared = await Promise.all(
      args.inboxes.map(async (inbox) => {
        let credentials: { encrypted: string } | undefined;
        if (inbox.imap || inbox.smtp) {
          credentials = {
            encrypted: await encryptString(
              JSON.stringify({ imap: inbox.imap, smtp: inbox.smtp }),
            ),
          };
        }
        return {
          email: inbox.email,
          provider: inbox.provider,
          dailyLimit: inbox.dailyLimit,
          credentials,
        };
      }),
    );
    const result = await ctx.runMutation(internal.outreach.addInboxes, {
      inboxes: prepared,
    });

    // Best-effort engine registration — local state is the source of truth,
    // the sync cron reconciles health/status afterwards.
    const engineErrors: string[] = [];
    if (instantlyConfigured()) {
      for (const inbox of args.inboxes) {
        if (inbox.provider !== "imap_smtp" || !inbox.imap || !inbox.smtp) continue;
        const row = result.inserted.find(
          (r) => r.email === inbox.email.trim().toLowerCase(),
        );
        try {
          await createAccount({
            email: inbox.email,
            imap: inbox.imap,
            smtp: inbox.smtp,
            dailyLimit: inbox.dailyLimit,
          });
          await enableWarmup([inbox.email]);
          if (row) {
            await ctx.runMutation(internal.outreach.updateInboxHealth, {
              id: row.id,
              engineConnected: true,
              status: "warming",
              clearEngineError: true,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "engine error";
          if (isAlreadyRegistered(message)) {
            if (row) {
              await ctx.runMutation(internal.outreach.updateInboxHealth, {
                id: row.id,
                engineConnected: true,
                clearEngineError: true,
              });
            }
          } else {
            engineErrors.push(`${inbox.email}: ${message.replace(/^Instantly \d+: /, "")}`);
            if (row) {
              await ctx.runMutation(internal.outreach.updateInboxHealth, {
                id: row.id,
                status: "error",
                lastEngineError: message.replace(/^Instantly \d+: /, ""),
              });
            }
          }
        }
      }
    }
    return { added: result.added, skipped: result.skipped, engineErrors };
  },
});

/** Flip warmup locally and mirror it to Instantly when connected. */
export const toggleWarmup = action({
  args: { id: v.id("inboxes") },
  handler: async (
    ctx,
    args,
  ): Promise<{ next: boolean; engineSynced: boolean; engineError?: string }> => {
    const { next, email } = await ctx.runMutation(
      internal.outreach.toggleWarmupLocal,
      { id: args.id },
    );
    if (!instantlyConfigured()) {
      return { next, engineSynced: false, engineError: "not_configured" };
    }
    try {
      if (next) await enableWarmup([email]);
      else await pauseWarmup([email]);
      return { next, engineSynced: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "engine error";
      console.error("Warmup sync failed:", error);
      return {
        next,
        engineSynced: false,
        engineError: message.includes("404") ? "account_not_registered" : message,
      };
    }
  },
});

/**
 * Campaign lifecycle. Publishing mirrors the campaign into Instantly
 * (campaign + sequence + schedule + leads) and activates it there; without
 * the key everything stays local so the flow remains testable.
 */
export const setCampaignStatus = action({
  args: {
    id: v.id("campaigns"),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("completed")),
  },
  handler: async (ctx, args): Promise<void> => {
    if (!instantlyConfigured()) {
      await ctx.runMutation(internal.outreach.setCampaignStatusLocal, {
        id: args.id,
        status: args.status,
      });
      return;
    }

    const campaign = await ctx.runQuery(internal.outreach.getCampaignForPublish, {
      id: args.id,
    });
    if (!campaign) throw new Error("Campaign not found");

    let instantlyId = campaign.instantlyId ?? undefined;
    if (args.status === "active" && !instantlyId) {
      // First activation: create in Instantly with our snake_case merge tags
      // translated to Instantly's camelCase ones, then add leads.
      instantlyId = await createCampaign({
        name: campaign.name,
        timezone: toEngineTimezone(campaign.timezone),
        windowStart: campaign.windowStart,
        windowEnd: campaign.windowEnd,
        dailyLimit: campaign.dailyCap,
        emailList: campaign.emailList,
        steps: campaign.steps.map((step) => ({
          waitDays: step.waitDays,
          subject: toInstantlyTags(step.subject),
          variants: step.variants.map(toInstantlyTags),
        })),
      });
      await addLeadsToCampaign(instantlyId, campaign.leads);
    }
    if (instantlyId) {
      if (args.status === "active") await activateCampaign(instantlyId);
      else await pauseCampaign(instantlyId);
    }
    await ctx.runMutation(internal.outreach.setCampaignStatusLocal, {
      id: args.id,
      status: args.status,
      instantlyId,
    });
  },
});

/** Add leads to an existing campaign, pushing new ones into Instantly when live. */
export const addCampaignLeads = action({
  args: {
    id: v.id("campaigns"),
    leadIds: v.array(v.id("leads")),
    quickAdd: v.array(
      v.object({ email: v.string(), name: v.optional(v.string()) }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    added: number;
    alreadyIn: number;
    engineSynced: boolean;
    engineError?: string;
  }> => {
    const result = await ctx.runMutation(internal.outreach.addCampaignLeadsLocal, args);
    if (!result.instantlyId || !instantlyConfigured() || result.newLeads.length === 0) {
      return {
        added: result.added,
        alreadyIn: result.alreadyIn,
        engineSynced: !result.instantlyId,
      };
    }
    try {
      await addLeadsToCampaign(result.instantlyId, result.newLeads);
      return { added: result.added, alreadyIn: result.alreadyIn, engineSynced: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "engine error";
      console.error("Lead push to engine failed:", error);
      return {
        added: result.added,
        alreadyIn: result.alreadyIn,
        engineSynced: false,
        engineError: message,
      };
    }
  },
});

/** Edit a campaign locally and mirror the changes into Instantly when live. */
export const updateCampaign = action({
  args: {
    id: v.id("campaigns"),
    name: v.string(),
    steps: v.array(
      v.object({
        waitDays: v.number(),
        subject: v.string(),
        variants: v.array(v.string()),
      }),
    ),
    sendWindowStart: v.string(),
    sendWindowEnd: v.string(),
    timezone: v.string(),
    dailyCap: v.number(),
    inboxIds: v.array(v.id("inboxes")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ engineSynced: boolean; engineError?: string }> => {
    const { instantlyId } = await ctx.runMutation(
      internal.outreach.updateCampaignLocal,
      args,
    );
    if (!instantlyId || !instantlyConfigured()) {
      return { engineSynced: !instantlyId };
    }
    try {
      const campaign = await ctx.runQuery(internal.outreach.getCampaignForPublish, {
        id: args.id,
      });
      if (!campaign) throw new Error("Campaign not found");
      await updateEngineCampaign(instantlyId, {
        name: campaign.name,
        timezone: toEngineTimezone(campaign.timezone),
        windowStart: campaign.windowStart,
        windowEnd: campaign.windowEnd,
        dailyLimit: campaign.dailyCap,
        emailList: campaign.emailList,
        steps: campaign.steps.map((step) => ({
          waitDays: step.waitDays,
          subject: toInstantlyTags(step.subject),
          variants: step.variants.map(toInstantlyTags),
        })),
      });
      return { engineSynced: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "engine error";
      console.error("Campaign engine sync failed:", error);
      return { engineSynced: false, engineError: message };
    }
  },
});

/** Reply from the master inbox, relayed through the inbox that received it. */
export const sendReply = action({
  args: { id: v.id("replies"), body: v.string() },
  handler: async (ctx, args): Promise<{ relayed: boolean }> => {
    if (!args.body.trim()) throw new Error("Write a reply first");
    const reply = await ctx.runMutation(internal.outreach.markReplied, {
      id: args.id,
      body: args.body,
    });
    if (instantlyConfigured() && reply.instantlyId && reply.eaccount) {
      await replyToEmail({
        replyToId: reply.instantlyId,
        eaccount: reply.eaccount,
        subject: reply.subject.startsWith("Re:") ? reply.subject : `Re: ${reply.subject}`,
        bodyText: args.body,
      });
      return { relayed: true };
    }
    return { relayed: false };
  },
});

/** Pull warmup health, unibox replies, and campaign stats from Instantly. */
export const syncEngine = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    if (!instantlyConfigured()) return;

    const inboxes = await ctx.runQuery(internal.outreach.listAllInboxes, {});

    // 0. Backfill: register IMAP/SMTP inboxes that were connected before the
    // engine key existed (their credentials are stored encrypted).
    const engineEmails: { _id: (typeof inboxes)[number]["_id"]; email: string }[] = [];
    for (const inbox of inboxes) {
      if (inbox.engineConnected) {
        engineEmails.push({ _id: inbox._id, email: inbox.email });
        continue;
      }
      if (inbox.provider !== "imap_smtp" || !inbox.credentials) continue;
      try {
        const decrypted = JSON.parse(
          await decryptString(inbox.credentials.encrypted),
        ) as {
          imap?: { host: string; port: string; username: string; password: string };
          smtp?: { host: string; port: string; username: string; password: string };
        };
        if (!decrypted.imap || !decrypted.smtp) continue;
        await createAccount({
          email: inbox.email,
          imap: decrypted.imap,
          smtp: decrypted.smtp,
          dailyLimit: inbox.dailyLimit,
        });
        if (inbox.warmupEnabled) await enableWarmup([inbox.email]);
        await ctx.runMutation(internal.outreach.updateInboxHealth, {
          id: inbox._id,
          engineConnected: true,
          status: "warming",
          clearEngineError: true,
        });
        engineEmails.push({ _id: inbox._id, email: inbox.email });
      } catch (error) {
        const message = error instanceof Error ? error.message : "engine error";
        // Only an explicit duplicate means the account is already registered.
        if (isAlreadyRegistered(message)) {
          await ctx.runMutation(internal.outreach.updateInboxHealth, {
            id: inbox._id,
            engineConnected: true,
            clearEngineError: true,
          });
          engineEmails.push({ _id: inbox._id, email: inbox.email });
        } else {
          console.error(`Engine registration failed for ${inbox.email}:`, error);
          await ctx.runMutation(internal.outreach.updateInboxHealth, {
            id: inbox._id,
            status: "error",
            lastEngineError: message.replace(/^Instantly \d+: /, ""),
          });
        }
      }
    }

    // 1. Authoritative account state + warmup analytics → warmup
    // confirmation, health score, sent volume, warmed status.
    if (engineEmails.length > 0) {
      try {
        const accounts = await listAccounts();
        const analytics = await getWarmupAnalytics(
          engineEmails.map((i) => i.email),
        );
        for (const inbox of engineEmails) {
          const account = accounts.find(
            (a) => a.email === inbox.email.toLowerCase(),
          );
          const stats = analytics.find((a) => a.email === inbox.email);
          // stat_warmup_score is what Instantly's own dashboard shows (0 until
          // enough data); prefer it so our Health column always matches theirs.
          const health = account?.warmupScore ?? stats?.healthScore ?? null;
          // "Warmed" needs both good deliverability AND real volume — a
          // single delivered warmup email scores 100% but proves nothing.
          const warmed = health != null && health >= 80 && (stats?.sentTotal ?? 0) >= 30;
          await ctx.runMutation(internal.outreach.updateInboxHealth, {
            id: inbox._id,
            engineConnected: true,
            ...(account && { engineWarmupActive: account.warmupActive }),
            ...(stats && {
              warmupSentTotal: stats.sentTotal,
              warmupSentLastDay: stats.sentLastDay,
            }),
            ...(health != null && {
              healthScore: health,
              status: warmed ? ("warmed" as const) : ("warming" as const),
            }),
          });
        }
      } catch (error) {
        console.error("Account state sync failed:", error);
      }
    }

    // 2. Unibox → master inbox replies.
    try {
      const emails = await listReplyEmails(100);
      for (const email of emails) {
        if (!email.id || !email.fromEmail) continue;
        await ctx.runMutation(internal.outreach.upsertReply, {
          instantlyId: email.id,
          instantlyCampaignId: email.campaignId ?? undefined,
          leadEmail: email.fromEmail,
          fromName: email.fromName ?? undefined,
          subject: email.subject,
          body: email.bodyText,
          receivedAt: email.timestamp,
          eaccount: email.eaccount ?? undefined,
        });
      }
    } catch (error) {
      console.error("Unibox sync failed:", error);
    }

    // 3. Campaign analytics → stats.
    try {
      const campaigns = await ctx.runQuery(
        internal.outreach.listActiveEngineCampaigns,
        {},
      );
      for (const campaign of campaigns) {
        const stats = await getCampaignAnalytics(campaign.instantlyId);
        await ctx.runMutation(internal.outreach.updateCampaignStats, {
          id: campaign._id,
          ...stats,
        });
      }
    } catch (error) {
      console.error("Campaign analytics sync failed:", error);
    }
  },
});

/** Manual "sync now" from the UI. */
export const syncNow = action({
  args: {},
  handler: async (ctx): Promise<{ configured: boolean }> => {
    if (!instantlyConfigured()) return { configured: false };
    await ctx.runAction(internal.outreachActions.syncEngine, {});
    return { configured: true };
  },
});

export type ConnectResult = { added: number; skipped: number; engineErrors: string[] };
export type SetStatusArgs = { id: Id<"campaigns">; status: "active" | "paused" | "completed" };
