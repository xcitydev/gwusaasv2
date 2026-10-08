import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { getConfigValue } from "./config";
import {
  getCurrentUser,
  requireUser,
  getPrimaryWorkspace,
  getAdminOrNull,
  requireAdmin,
} from "./lib/auth";
import { notify } from "./notifications";

async function requireWorkspace(ctx: Ctx) {
  const user = await requireUser(ctx);
  const workspace = await getPrimaryWorkspace(ctx, user._id);
  if (!workspace) throw new Error("No workspace");
  return { user, workspace };
}

async function currentWorkspace(ctx: Ctx) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  return await getPrimaryWorkspace(ctx, user._id);
}

/**
 * Outreach capacity. Instantly is ONE platform account with a fixed quota
 * (instantlyPlanContacts uploaded contacts, instantlyPlanEmails emails a
 * month), shared by every workspace. These caps keep each workspace inside
 * its plan's share and the whole platform inside the Instantly plan:
 *
 *   contacts  = distinct leads enrolled in non-archived campaigns
 *   emails    = emails sent this calendar month (from Instantly analytics)
 *   inboxes   = connected sending inboxes
 *
 * Caps are admin config keys (outreach*Personal / outreach*Team), so they
 * move with the Instantly plan without a deploy.
 */

type Ctx = QueryCtx | MutationCtx;

export type OutreachCaps = { contacts: number; emails: number; inboxes: number };

export async function capsFor(ctx: Ctx, plan: Doc<"workspaces">["plan"]): Promise<OutreachCaps> {
  const team = plan === "team";
  const [contacts, emails, inboxes] = await Promise.all([
    getConfigValue(ctx, team ? "outreachContactsTeam" : "outreachContactsPersonal"),
    getConfigValue(ctx, team ? "outreachEmailsTeam" : "outreachEmailsPersonal"),
    getConfigValue(ctx, team ? "outreachInboxesTeam" : "outreachInboxesPersonal"),
  ]);
  // Free is gated out of Outreach entirely; zero keeps any bypass harmless.
  if (plan === "free") return { contacts: 0, emails: 0, inboxes: 0 };
  return { contacts, emails, inboxes };
}

/** Calendar month key in UTC, e.g. "2026-10". */
export function monthKey(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** First instant of next month (UTC), when the email counter resets. */
export function monthResetAt(ts = Date.now()): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

const COUNTED_STATUSES = new Set(["draft", "active", "paused", "completed"]);

/** Distinct leads enrolled in this workspace's non-archived campaigns. */
export async function enrolledContactIds(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
): Promise<Set<string>> {
  const campaigns = await ctx.db
    .query("campaigns")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const ids = new Set<string>();
  for (const c of campaigns) {
    if (!COUNTED_STATUSES.has(c.status)) continue;
    const links = await ctx.db
      .query("campaignLeads")
      .withIndex("by_campaign", (q) => q.eq("campaignId", c._id))
      .collect();
    for (const l of links) ids.add(l.leadId);
  }
  return ids;
}

/** Recount and cache the workspace's enrolled-contact figure (feeds the platform pool). */
export async function refreshContactCount(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<number> {
  const count = (await enrolledContactIds(ctx, workspaceId)).size;
  await ctx.db.patch(workspaceId, { outreachContacts: count });
  return count;
}

async function platformContacts(ctx: Ctx): Promise<number> {
  const workspaces = await ctx.db.query("workspaces").collect();
  return workspaces.reduce((s, w) => s + (w.outreachContacts ?? 0), 0);
}

async function platformEmailsThisMonth(ctx: Ctx): Promise<number> {
  const rows = await ctx.db
    .query("outreachUsage")
    .withIndex("by_month", (q) => q.eq("month", monthKey()))
    .collect();
  return rows.reduce((s, r) => s + r.emailsSent, 0);
}

export async function usageRow(
  ctx: Ctx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"outreachUsage"> | null> {
  return await ctx.db
    .query("outreachUsage")
    .withIndex("by_workspace_month", (q) =>
      q.eq("workspaceId", workspaceId).eq("month", monthKey()),
    )
    .unique();
}

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Refuse enrolling `newLeadIds` when the workspace or the platform would go
 * over its contact cap. Leads already enrolled are free (re-adding costs
 * nothing). Call BEFORE inserting the campaignLeads rows.
 */
export async function assertContactRoom(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  newLeadIds: Id<"leads">[],
): Promise<void> {
  const enrolled = await enrolledContactIds(ctx, workspace._id);
  const fresh = new Set(newLeadIds.filter((id) => !enrolled.has(id)));
  if (fresh.size === 0) return;
  const caps = await capsFor(ctx, workspace.plan);
  const after = enrolled.size + fresh.size;
  if (after > caps.contacts) {
    const upgrade =
      workspace.plan === "team"
        ? "Archive a finished campaign to free contacts."
        : "Archive a finished campaign, or move to Team for more.";
    throw new Error(
      `Contact limit: your plan allows ${fmt(caps.contacts)} contacts in outreach. You have ${fmt(enrolled.size)} and this adds ${fmt(fresh.size)}. ${upgrade}`,
    );
  }
  const poolCap = await getConfigValue(ctx, "instantlyPlanContacts");
  const pool = (await platformContacts(ctx)) - (workspace.outreachContacts ?? 0) + after;
  if (pool > poolCap) {
    throw new Error(
      "Platform capacity: the sending engine is at its contact limit right now. The team has been alerted; try again later or archive a finished campaign.",
    );
  }
}

/** Per-campaign daily cap can never exceed a twentieth of the monthly email cap. */
export async function assertDailyCap(
  ctx: Ctx,
  workspace: Doc<"workspaces">,
  dailyCap: number,
): Promise<void> {
  const caps = await capsFor(ctx, workspace.plan);
  const max = Math.max(1, Math.floor(caps.emails / 20));
  if (dailyCap > max) {
    throw new Error(
      `Daily cap: your plan sends up to ${fmt(caps.emails)} emails a month, so a campaign can send at most ${fmt(max)} a day.`,
    );
  }
}

/** Refuse connecting inboxes past the plan's inbox cap. */
export async function assertInboxRoom(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  adding: number,
): Promise<void> {
  if (adding <= 0) return;
  const existing = await ctx.db
    .query("inboxes")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
    .collect();
  const caps = await capsFor(ctx, workspace.plan);
  if (existing.length + adding > caps.inboxes) {
    const upgrade = workspace.plan === "team" ? "" : " Team allows more.";
    throw new Error(
      `Inbox limit: your plan allows ${caps.inboxes} connected inboxes and you have ${existing.length}.${upgrade}`,
    );
  }
}

/** The workspace's numbers for the Outreach page. */
export const usage = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return null;
    const [caps, enrolled, row, inboxes] = await Promise.all([
      capsFor(ctx, workspace.plan),
      enrolledContactIds(ctx, workspace._id),
      usageRow(ctx, workspace._id),
      ctx.db
        .query("inboxes")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect(),
    ]);
    return {
      plan: workspace.plan,
      caps,
      contacts: enrolled.size,
      emailsThisMonth: row?.emailsSent ?? 0,
      inboxes: inboxes.length,
      maxDailyCap: Math.max(1, Math.floor(caps.emails / 20)),
      pausedForCap: row?.pausedForCap ?? false,
      resetsAt: monthResetAt(),
    };
  },
});

/** Can this workspace (re)activate a campaign right now? */
export const activationCheck = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { workspace } = await requireWorkspace(ctx);
    const [caps, row] = await Promise.all([capsFor(ctx, workspace.plan), usageRow(ctx, workspace._id)]);
    const sent = row?.emailsSent ?? 0;
    if (sent >= caps.emails) {
      return {
        ok: false as const,
        reason: `Monthly email limit: your plan sends up to ${fmt(caps.emails)} emails a month and you have sent ${fmt(sent)}. Sending resumes on ${new Date(monthResetAt()).toUTCString().slice(5, 16)}.`,
      };
    }
    const [poolCap, pool] = await Promise.all([
      getConfigValue(ctx, "instantlyPlanEmails"),
      platformEmailsThisMonth(ctx),
    ]);
    if (pool >= poolCap) {
      return {
        ok: false as const,
        reason: "Platform capacity: the sending engine has reached its monthly email limit. The team has been alerted.",
      };
    }
    return { ok: true as const };
  },
});

/**
 * Called by the engine sync for every live campaign with its cumulative
 * sent count. The first time a campaign is seen, its history is NOT
 * counted (the counter starts from deploy). Returns whether the workspace
 * has now crossed its monthly cap, with the campaigns to pause.
 */
export const recordSent = internalMutation({
  args: { campaignId: v.id("campaigns"), sent: v.number() },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return { overCap: false as const };
    const accounted = campaign.sentAccounted;
    await ctx.db.patch(campaign._id, { sentAccounted: args.sent });
    const delta = accounted === undefined ? 0 : Math.max(0, args.sent - accounted);
    const workspace = await ctx.db.get(campaign.workspaceId);
    if (!workspace) return { overCap: false as const };

    let row = await usageRow(ctx, workspace._id);
    if (!row) {
      const id = await ctx.db.insert("outreachUsage", {
        workspaceId: workspace._id,
        month: monthKey(),
        emailsSent: 0,
        pausedForCap: false,
      });
      row = (await ctx.db.get(id))!;
    }
    const emailsSent = row.emailsSent + delta;
    if (delta > 0) await ctx.db.patch(row._id, { emailsSent });

    const caps = await capsFor(ctx, workspace.plan);
    if (emailsSent < caps.emails || row.pausedForCap) return { overCap: false as const };

    // Crossed the cap this sync: pause everything live for the workspace.
    const live = await ctx.db
      .query("campaigns")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const toPause = live.filter((c) => c.status === "active");
    for (const c of toPause) {
      await ctx.db.patch(c._id, { status: "paused", statusChangedAt: Date.now() });
    }
    await ctx.db.patch(row._id, { pausedForCap: true });
    await notify(ctx, {
      userId: workspace.ownerId,
      workspaceId: workspace._id,
      type: "outreach_cap",
      title: `Monthly email limit reached (${fmt(caps.emails)})`,
      body: `${toPause.length} campaign${toPause.length === 1 ? "" : "s"} paused until ${new Date(monthResetAt()).toUTCString().slice(5, 16)}.${workspace.plan === "team" ? "" : " Team sends three times as many."}`,
      href: "/outreach",
    });
    return {
      overCap: true as const,
      instantlyIds: toPause.map((c) => c.instantlyId).filter((id): id is string => Boolean(id)),
    };
  },
});

/** Platform-wide pool vs the Instantly plan, for Admin → Infrastructure. */
export const platformPool = query({
  args: {},
  handler: async (ctx) => {
    if (!(await getAdminOrNull(ctx, "dev"))) return null;
    const [contactsCap, emailsCap, contacts, emails, workspaces] = await Promise.all([
      getConfigValue(ctx, "instantlyPlanContacts"),
      getConfigValue(ctx, "instantlyPlanEmails"),
      platformContacts(ctx),
      platformEmailsThisMonth(ctx),
      ctx.db.query("workspaces").collect(),
    ]);
    const usageRows = await ctx.db
      .query("outreachUsage")
      .withIndex("by_month", (q) => q.eq("month", monthKey()))
      .collect();
    const emailsByWorkspace = new Map(usageRows.map((r) => [r.workspaceId, r.emailsSent]));
    const top = workspaces
      .map((w) => ({
        workspaceId: w._id,
        name: w.name,
        plan: w.plan,
        contacts: w.outreachContacts ?? 0,
        emailsThisMonth: emailsByWorkspace.get(w._id) ?? 0,
      }))
      .filter((w) => w.contacts > 0 || w.emailsThisMonth > 0)
      .sort((a, b) => b.contacts - a.contacts || b.emailsThisMonth - a.emailsThisMonth)
      .slice(0, 10);
    return {
      month: monthKey(),
      resetsAt: monthResetAt(),
      contacts,
      contactsCap,
      emails,
      emailsCap,
      topWorkspaces: top,
    };
  },
});

/**
 * Alert admins once per month when the platform pool passes 80% of the
 * Instantly plan. Runs at the end of each engine sync.
 */
export const checkPlatformPool = internalMutation({
  args: {},
  handler: async (ctx) => {
    const [contactsCap, emailsCap, contacts, emails] = await Promise.all([
      getConfigValue(ctx, "instantlyPlanContacts"),
      getConfigValue(ctx, "instantlyPlanEmails"),
      platformContacts(ctx),
      platformEmailsThisMonth(ctx),
    ]);
    const contactPct = contactsCap ? contacts / contactsCap : 0;
    const emailPct = emailsCap ? emails / emailsCap : 0;
    if (contactPct < 0.8 && emailPct < 0.8) return { alerted: false };
    const marker = `pool-alert:${monthKey()}`;
    const already = await ctx.db
      .query("outreachUsage")
      .withIndex("by_month", (q) => q.eq("month", marker))
      .first();
    if (already) return { alerted: false };
    const admins = (await ctx.db.query("users").collect()).filter((u) => u.adminRole);
    const title = `Sending engine at ${Math.round(Math.max(contactPct, emailPct) * 100)}% of the Instantly plan`;
    for (const admin of admins) {
      await notify(ctx, {
        userId: admin._id,
        type: "platform_pool",
        title,
        body: `${fmt(contacts)} / ${fmt(contactsCap)} contacts · ${fmt(emails)} / ${fmt(emailsCap)} emails this month. Upgrade the Instantly plan or raise caps in Admin → Config.`,
        href: "/admin/infra",
      });
    }
    // One alert per month: a sentinel row keyed by a month string no workspace uses.
    const anyWorkspace = await ctx.db.query("workspaces").first();
    if (anyWorkspace) {
      await ctx.db.insert("outreachUsage", {
        workspaceId: anyWorkspace._id,
        month: marker,
        emailsSent: 0,
        pausedForCap: false,
      });
    }
    return { alerted: true };
  },
});

/** Local half of archiving: flips status, frees the workspace's contact count. */
export const markArchived = internalMutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.id);
    if (!campaign) return;
    await ctx.db.patch(args.id, { status: "archived", statusChangedAt: Date.now() });
    await refreshContactCount(ctx, campaign.workspaceId);
  },
});

/** Campaigns completed more than `days` days ago and never archived. */
export const listStaleCompleted = internalQuery({
  args: { days: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000;
    const all = await ctx.db.query("campaigns").collect();
    return all
      .filter((c) => c.status === "completed" && (c.statusChangedAt ?? c._creationTime) < cutoff)
      .map((c) => ({ _id: c._id, instantlyId: c.instantlyId ?? null, workspaceId: c.workspaceId }));
  },
});

/** The caller's own campaign, for the archive action's ownership check. */
export const ownCampaign = query({
  args: { id: v.id("campaigns") },
  handler: async (ctx, args) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return null;
    const campaign = await ctx.db.get(args.id);
    if (!campaign || campaign.workspaceId !== workspace._id) return null;
    return { _id: campaign._id, status: campaign.status, instantlyId: campaign.instantlyId ?? null };
  },
});

/** Support tool: clear a workspace's current-month email tally (dev admin). */
export const adminResetUsage = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "dev");
    const row = await usageRow(ctx, args.workspaceId);
    if (row) await ctx.db.delete(row._id);
    return { cleared: Boolean(row) };
  },
});

/** One-off / safety: recount every workspace's enrolled contacts. */
export const recountAll = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx, "dev");
    const workspaces = await ctx.db.query("workspaces").collect();
    let n = 0;
    for (const w of workspaces) {
      await refreshContactCount(ctx, w._id);
      n++;
    }
    return { recounted: n };
  },
});
