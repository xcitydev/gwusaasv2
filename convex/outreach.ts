import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { getCurrentUser, requireUser, getPrimaryWorkspace } from "./lib/auth";

async function requireWorkspace(ctx: Parameters<typeof requireUser>[0]) {
  const user = await requireUser(ctx);
  const workspace = await getPrimaryWorkspace(ctx, user._id);
  if (!workspace) throw new Error("No workspace");
  return { user, workspace };
}

async function currentWorkspace(ctx: Parameters<typeof getCurrentUser>[0]) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  return await getPrimaryWorkspace(ctx, user._id);
}

// ── Inboxes ─────────────────────────────────────────────────────────────

export const listInboxes = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return [];
    const inboxes = await ctx.db
      .query("inboxes")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .collect();
    // Credentials never leave the backend.
    return inboxes.map((inbox) => {
      const { credentials, ...rest } = inbox;
      void credentials;
      return rest;
    });
  },
});

export const addInboxes = internalMutation({
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
        credentials: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    let added = 0;
    let skipped = 0;
    const inserted: { id: Doc<"inboxes">["_id"]; email: string }[] = [];
    for (const inbox of args.inboxes) {
      const email = inbox.email.trim().toLowerCase();
      if (!email.includes("@")) {
        skipped++;
        continue;
      }
      const existing = await ctx.db
        .query("inboxes")
        .withIndex("by_workspace_email", (q) =>
          q.eq("workspaceId", workspace._id).eq("email", email),
        )
        .unique();
      if (existing) {
        skipped++;
        continue;
      }
      const id = await ctx.db.insert("inboxes", {
        workspaceId: workspace._id,
        email,
        provider: inbox.provider,
        // Real warmup is gated by Instantly; until that key exists, mark
        // inboxes warmed immediately so campaigns are fully testable.
        status:
          inbox.provider === "prewarmed" || !process.env.INSTANTLY_API_KEY
            ? "warmed"
            : "warming",
        dailyLimit: inbox.dailyLimit,
        warmupEnabled: true,
        credentials: inbox.credentials,
      });
      inserted.push({ id, email });
      added++;
    }
    return { added, skipped, inserted };
  },
});

export const toggleWarmupLocal = internalMutation({
  args: { id: v.id("inboxes") },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const inbox = await ctx.db.get(args.id);
    if (!inbox || inbox.workspaceId !== workspace._id) throw new Error("Not found");
    const next = !(inbox.warmupEnabled ?? true);
    await ctx.db.patch(args.id, { warmupEnabled: next });
    return { next, email: inbox.email };
  },
});

/** Cron + sync targets: every inbox across all workspaces. */
export const listAllInboxes = internalQuery({
  args: {},
  handler: async (ctx) => {
    const inboxes = await ctx.db.query("inboxes").collect();
    return inboxes.map((inbox) => ({
      _id: inbox._id,
      email: inbox.email,
      provider: inbox.provider,
      status: inbox.status,
      warmupEnabled: inbox.warmupEnabled ?? true,
      engineConnected: inbox.engineConnected ?? false,
      hasCredentials: Boolean(inbox.credentials),
      // Encrypted blob — only ever decrypted inside the sync action.
      credentials: inbox.credentials as { encrypted: string } | undefined,
      dailyLimit: inbox.dailyLimit,
    }));
  },
});

export const updateInboxHealth = internalMutation({
  args: {
    id: v.id("inboxes"),
    healthScore: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("connecting"),
        v.literal("warming"),
        v.literal("warmed"),
        v.literal("error"),
      ),
    ),
    engineConnected: v.optional(v.boolean()),
    lastEngineError: v.optional(v.string()),
    clearEngineError: v.optional(v.boolean()),
    engineWarmupActive: v.optional(v.boolean()),
    warmupSentTotal: v.optional(v.number()),
    warmupSentLastDay: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, clearEngineError, ...patch } = args;
    await ctx.db.patch(id, {
      ...patch,
      ...(clearEngineError && { lastEngineError: undefined }),
    });
  },
});

export const removeInbox = mutation({
  args: { id: v.id("inboxes") },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const inbox = await ctx.db.get(args.id);
    if (!inbox || inbox.workspaceId !== workspace._id) throw new Error("Not found");
    await ctx.db.delete(args.id);
  },
});

// ── Domains ─────────────────────────────────────────────────────────────

export const listDomains = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return [];
    return await ctx.db
      .query("emailDomains")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .collect();
  },
});

export const addDomain = mutation({
  args: { domain: v.string() },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const domain = args.domain.trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
      throw new Error("Enter a valid domain, e.g. mybrand.com");
    }
    await ctx.db.insert("emailDomains", {
      workspaceId: workspace._id,
      domain,
      status: "pending",
      registrar: "porkbun",
    });
  },
});

/** Redirect ALL purchased domains to one target the user specifies. */
export const redirectAllDomains = mutation({
  args: { target: v.string() },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const target = args.target.trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(target)) {
      throw new Error("Enter a valid target domain, e.g. mybrand.com");
    }
    const domains = await ctx.db
      .query("emailDomains")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    for (const domain of domains) {
      await ctx.db.patch(domain._id, { redirectTarget: target });
    }
    // TODO(porkbun): push URL-forwarding records via the Porkbun API when
    // PORKBUN_API_KEY is configured.
    return domains.length;
  },
});

export const setForwardRepliesTo = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const email = args.email.trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      throw new Error("Enter a valid email address");
    }
    await ctx.db.patch(workspace._id, { forwardRepliesTo: email || undefined });
  },
});

export const outreachSettings = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return null;
    return { forwardRepliesTo: workspace.forwardRepliesTo ?? "" };
  },
});

// ── Campaigns ───────────────────────────────────────────────────────────

const stepInput = v.object({
  waitDays: v.number(),
  subject: v.string(),
  variants: v.array(v.string()),
});

export const listCampaigns = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return [];
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .collect();
    return await Promise.all(
      campaigns.map(async (c) => {
        const leads = await ctx.db
          .query("campaignLeads")
          .withIndex("by_campaign", (q) => q.eq("campaignId", c._id))
          .collect();
        return { ...c, leadCount: leads.length };
      }),
    );
  },
});

export const getCampaign = query({
  args: { id: v.id("campaigns") },
  handler: async (ctx, args) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return null;
    const campaign = await ctx.db.get(args.id);
    if (!campaign || campaign.workspaceId !== workspace._id) return null;
    const steps = await ctx.db
      .query("sequenceSteps")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.id))
      .collect();
    const links = await ctx.db
      .query("campaignLeads")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.id))
      .collect();
    const leads = (
      await Promise.all(links.slice(0, 200).map((l) => ctx.db.get(l.leadId)))
    )
      .filter((l): l is Doc<"leads"> => l !== null)
      .map((l) => ({
        _id: l._id,
        email: l.email,
        name: l.name,
        company: l.company,
        title: l.title,
        phone: l.phone,
        location: l.location,
        industry: l.industry,
        website: l.website,
      }));
    const inboxes = await Promise.all(campaign.inboxIds.map((id) => ctx.db.get(id)));
    return {
      ...campaign,
      steps: steps.sort((a, b) => a.order - b.order),
      leadCount: links.length,
      leads,
      inboxes: inboxes
        .filter((i): i is Doc<"inboxes"> => i !== null)
        .map((i) => ({ _id: i._id, email: i.email, status: i.status })),
    };
  },
});

/** Local half of editing a campaign; the action mirrors changes to Instantly. */
export const updateCampaignLocal = internalMutation({
  args: {
    id: v.id("campaigns"),
    name: v.string(),
    steps: v.array(stepInput),
    sendWindowStart: v.string(),
    sendWindowEnd: v.string(),
    timezone: v.string(),
    dailyCap: v.number(),
    inboxIds: v.array(v.id("inboxes")),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const campaign = await ctx.db.get(args.id);
    if (!campaign || campaign.workspaceId !== workspace._id) throw new Error("Not found");
    if (!args.name.trim()) throw new Error("Name your campaign");
    if (args.steps.length === 0) throw new Error("Add at least one email step");
    if (args.steps.some((s) => !s.subject.trim() || !s.variants[0]?.trim())) {
      throw new Error("Every step needs a subject and a script");
    }
    if (args.inboxIds.length === 0) throw new Error("Pick at least one inbox");
    if (args.dailyCap < 1) throw new Error("Daily cap must be at least 1");

    await ctx.db.patch(args.id, {
      name: args.name.trim(),
      sendWindowStart: args.sendWindowStart,
      sendWindowEnd: args.sendWindowEnd,
      timezone: args.timezone,
      dailyCap: args.dailyCap,
      inboxIds: args.inboxIds,
    });

    // Replace the sequence wholesale — simplest and always consistent.
    const existing = await ctx.db
      .query("sequenceSteps")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.id))
      .collect();
    await Promise.all(existing.map((s) => ctx.db.delete(s._id)));
    for (let i = 0; i < args.steps.length; i++) {
      await ctx.db.insert("sequenceSteps", {
        campaignId: args.id,
        order: i,
        waitDays: args.steps[i].waitDays,
        subject: args.steps[i].subject,
        variants: args.steps[i].variants.filter((v) => v.trim()),
      });
    }
    return { instantlyId: campaign.instantlyId ?? null };
  },
});

export const createCampaign = mutation({
  args: {
    name: v.string(),
    steps: v.array(stepInput),
    sendWindowStart: v.string(),
    sendWindowEnd: v.string(),
    timezone: v.string(),
    dailyCap: v.number(),
    inboxIds: v.array(v.id("inboxes")),
    leadIds: v.array(v.id("leads")),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    if (!args.name.trim()) throw new Error("Name your campaign");
    if (args.steps.length === 0) throw new Error("Add at least one email step");
    if (args.steps.some((s) => !s.subject.trim() || !s.variants[0]?.trim())) {
      throw new Error("Every step needs a subject and a script");
    }
    if (args.inboxIds.length === 0) throw new Error("Pick at least one inbox");
    if (args.leadIds.length === 0) throw new Error("Add at least one lead");
    if (args.dailyCap < 1) throw new Error("Daily cap must be at least 1");

    const campaignId = await ctx.db.insert("campaigns", {
      workspaceId: workspace._id,
      name: args.name.trim(),
      status: "draft",
      sendWindowStart: args.sendWindowStart,
      sendWindowEnd: args.sendWindowEnd,
      timezone: args.timezone,
      dailyCap: args.dailyCap,
      inboxIds: args.inboxIds,
      stats: { sent: 0, opened: 0, replied: 0, positive: 0 },
    });
    for (let i = 0; i < args.steps.length; i++) {
      await ctx.db.insert("sequenceSteps", {
        campaignId,
        order: i,
        waitDays: args.steps[i].waitDays,
        subject: args.steps[i].subject,
        variants: args.steps[i].variants.filter((v) => v.trim()),
      });
    }
    for (const leadId of args.leadIds) {
      const lead = await ctx.db.get(leadId);
      if (!lead || lead.workspaceId !== workspace._id) continue;
      await ctx.db.insert("campaignLeads", {
        campaignId,
        leadId,
        status: "queued",
      });
    }
    return campaignId;
  },
});

export const setCampaignStatusLocal = internalMutation({
  args: {
    id: v.id("campaigns"),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("completed")),
    instantlyId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const campaign = await ctx.db.get(args.id);
    if (!campaign || campaign.workspaceId !== workspace._id) throw new Error("Not found");
    await ctx.db.patch(args.id, {
      status: args.status,
      ...(args.instantlyId && { instantlyId: args.instantlyId }),
    });
    return { instantlyId: args.instantlyId ?? campaign.instantlyId ?? null };
  },
});

/**
 * Local half of adding leads to an existing campaign: quick-add rows become
 * store leads (deduped by email), then everything is linked to the campaign.
 * Returns the newly linked leads so the action can push them to Instantly.
 */
export const addCampaignLeadsLocal = internalMutation({
  args: {
    id: v.id("campaigns"),
    leadIds: v.array(v.id("leads")),
    quickAdd: v.array(
      v.object({ email: v.string(), name: v.optional(v.string()) }),
    ),
  },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const campaign = await ctx.db.get(args.id);
    if (!campaign || campaign.workspaceId !== workspace._id) throw new Error("Not found");

    const candidateIds = [...args.leadIds];
    for (const row of args.quickAdd) {
      const email = row.email.trim().toLowerCase();
      if (!email.includes("@")) continue;
      const existing = await ctx.db
        .query("leads")
        .withIndex("by_workspace_email", (q) =>
          q.eq("workspaceId", workspace._id).eq("email", email),
        )
        .unique();
      if (existing) {
        candidateIds.push(existing._id);
      } else {
        candidateIds.push(
          await ctx.db.insert("leads", {
            workspaceId: workspace._id,
            email,
            name: row.name?.trim() || undefined,
            source: "quick_add",
          }),
        );
      }
    }

    let added = 0;
    let alreadyIn = 0;
    const newLeads = [];
    for (const leadId of candidateIds) {
      const lead = await ctx.db.get(leadId);
      if (!lead || lead.workspaceId !== workspace._id) continue;
      const link = await ctx.db
        .query("campaignLeads")
        .withIndex("by_campaign_lead", (q) =>
          q.eq("campaignId", args.id).eq("leadId", leadId),
        )
        .unique();
      if (link) {
        alreadyIn++;
        continue;
      }
      await ctx.db.insert("campaignLeads", {
        campaignId: args.id,
        leadId,
        status: "queued",
      });
      added++;
      const [firstName, ...restName] = (lead.name ?? "").split(" ");
      newLeads.push({
        email: lead.email,
        firstName: firstName || undefined,
        lastName: restName.join(" ") || undefined,
        company: lead.company,
        phone: lead.phone,
        website: lead.website,
        title: lead.title,
        location: lead.location,
        industry: lead.industry,
        name: lead.name,
      });
    }

    return { added, alreadyIn, newLeads, instantlyId: campaign.instantlyId ?? null };
  },
});

/** Everything the publish action needs to mirror a campaign into Instantly. */
export const getCampaignForPublish = internalQuery({
  args: { id: v.id("campaigns") },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const campaign = await ctx.db.get(args.id);
    if (!campaign || campaign.workspaceId !== workspace._id) return null;
    const steps = await ctx.db
      .query("sequenceSteps")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.id))
      .collect();
    const links = await ctx.db
      .query("campaignLeads")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.id))
      .collect();
    const leads = [];
    for (const link of links) {
      const lead = await ctx.db.get(link.leadId);
      if (lead) {
        const [firstName, ...restName] = (lead.name ?? "").split(" ");
        leads.push({
          email: lead.email,
          firstName: firstName || undefined,
          lastName: restName.join(" ") || undefined,
          company: lead.company,
          phone: lead.phone,
          website: lead.website,
          // Supplied as Instantly custom variables for {{title}} etc.
          title: lead.title,
          location: lead.location,
          industry: lead.industry,
          name: lead.name,
        });
      }
    }
    const inboxes = await Promise.all(campaign.inboxIds.map((id) => ctx.db.get(id)));
    return {
      name: campaign.name,
      status: campaign.status,
      instantlyId: campaign.instantlyId ?? null,
      timezone: campaign.timezone,
      windowStart: campaign.sendWindowStart,
      windowEnd: campaign.sendWindowEnd,
      dailyCap: campaign.dailyCap,
      emailList: inboxes.flatMap((i) => (i ? [i.email] : [])),
      steps: steps
        .sort((a, b) => a.order - b.order)
        .map((s) => ({ waitDays: s.waitDays, subject: s.subject, variants: s.variants })),
      leads,
    };
  },
});

export const listActiveEngineCampaigns = internalQuery({
  args: {},
  handler: async (ctx) => {
    const campaigns = await ctx.db.query("campaigns").collect();
    return campaigns
      .filter((c) => c.instantlyId && c.status === "active")
      .map((c) => ({ _id: c._id, instantlyId: c.instantlyId! }));
  },
});

export const updateCampaignStats = internalMutation({
  args: {
    id: v.id("campaigns"),
    sent: v.number(),
    opened: v.number(),
    replied: v.number(),
  },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.id);
    if (!campaign) return;
    await ctx.db.patch(args.id, {
      stats: {
        sent: args.sent,
        opened: args.opened,
        replied: args.replied,
        positive: campaign.stats?.positive ?? 0,
      },
    });
  },
});

export const removeCampaign = mutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const campaign = await ctx.db.get(args.id);
    if (!campaign || campaign.workspaceId !== workspace._id) throw new Error("Not found");
    if (campaign.status === "active") {
      throw new Error("Pause the campaign before deleting it");
    }
    const steps = await ctx.db
      .query("sequenceSteps")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.id))
      .collect();
    const links = await ctx.db
      .query("campaignLeads")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.id))
      .collect();
    await Promise.all([
      ...steps.map((s) => ctx.db.delete(s._id)),
      ...links.map((l) => ctx.db.delete(l._id)),
    ]);
    await ctx.db.delete(args.id);
  },
});

// ── Master inbox ────────────────────────────────────────────────────────

export const listReplies = query({
  args: {
    category: v.optional(
      v.union(
        v.literal("interested"),
        v.literal("not_interested"),
        v.literal("out_of_office"),
        v.literal("unsubscribed"),
        v.literal("other"),
      ),
    ),
    campaignId: v.optional(v.id("campaigns")),
  },
  handler: async (ctx, args) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return [];
    let replies;
    if (args.category) {
      replies = await ctx.db
        .query("replies")
        .withIndex("by_workspace_category", (q) =>
          q.eq("workspaceId", workspace._id).eq("category", args.category!),
        )
        .order("desc")
        .take(200);
    } else {
      replies = await ctx.db
        .query("replies")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .order("desc")
        .take(200);
    }
    if (args.campaignId) {
      replies = replies.filter((r) => r.campaignId === args.campaignId);
    }
    // The inbox lists inbound messages; our own sent replies live in threads.
    return replies.filter((r) => r.direction !== "outbound");
  },
});

/** An inbound message plus every reply we sent to it, oldest first. */
export const getReplyThread = query({
  args: { id: v.id("replies") },
  handler: async (ctx, args) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return null;
    const reply = await ctx.db.get(args.id);
    if (!reply || reply.workspaceId !== workspace._id) return null;
    const sent = await ctx.db
      .query("replies")
      .withIndex("by_in_reply_to", (q) => q.eq("inReplyTo", args.id))
      .collect();
    return {
      ...reply,
      sentReplies: sent
        .sort((a, b) => a.receivedAt - b.receivedAt)
        .map((s) => ({
          _id: s._id,
          body: s.body,
          sentAt: s.receivedAt,
          eaccount: s.eaccount,
        })),
    };
  },
});

export const markReplyRead = mutation({
  args: { id: v.id("replies") },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const reply = await ctx.db.get(args.id);
    if (!reply || reply.workspaceId !== workspace._id) return;
    await ctx.db.patch(args.id, { read: true });
  },
});

export const getReplyContext = internalQuery({
  args: { id: v.id("replies") },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const reply = await ctx.db.get(args.id);
    if (!reply || reply.workspaceId !== workspace._id) return null;
    const campaign = reply.campaignId ? await ctx.db.get(reply.campaignId) : null;
    return { reply, campaignName: campaign?.name ?? null };
  },
});

/**
 * Local half of sending a reply: marks the inbound message read and records
 * the outbound message in the thread. The action relays through Instantly.
 */
export const markReplied = internalMutation({
  args: { id: v.id("replies"), body: v.string() },
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspace(ctx);
    const reply = await ctx.db.get(args.id);
    if (!reply || reply.workspaceId !== workspace._id) throw new Error("Not found");
    await ctx.db.patch(args.id, { read: true });
    await ctx.db.insert("replies", {
      workspaceId: workspace._id,
      campaignId: reply.campaignId,
      leadEmail: reply.leadEmail,
      fromName: undefined,
      subject: reply.subject.startsWith("Re:") ? reply.subject : `Re: ${reply.subject}`,
      body: args.body.trim(),
      category: reply.category,
      read: true,
      receivedAt: Date.now(),
      eaccount: reply.eaccount,
      direction: "outbound",
      inReplyTo: args.id,
    });
    return {
      instantlyId: reply.instantlyId ?? null,
      eaccount: reply.eaccount ?? null,
      subject: reply.subject,
    };
  },
});

/** Unibox sync: insert a reply once, matched to its campaign + workspace. */
export const upsertReply = internalMutation({
  args: {
    instantlyId: v.string(),
    instantlyCampaignId: v.optional(v.string()),
    leadEmail: v.string(),
    fromName: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    receivedAt: v.number(),
    eaccount: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("replies")
      .withIndex("by_instantly_id", (q) => q.eq("instantlyId", args.instantlyId))
      .unique();
    if (existing) return false;

    // Attribute via the campaign; replies we can't attribute are skipped.
    if (!args.instantlyCampaignId) return false;
    const campaign = await ctx.db
      .query("campaigns")
      .withIndex("by_instantly_id", (q) => q.eq("instantlyId", args.instantlyCampaignId))
      .unique();
    if (!campaign) return false;

    await ctx.db.insert("replies", {
      workspaceId: campaign.workspaceId,
      campaignId: campaign._id,
      leadEmail: args.leadEmail,
      fromName: args.fromName,
      subject: args.subject,
      body: args.body,
      category: categorize(args.subject, args.body),
      read: false,
      receivedAt: args.receivedAt,
      instantlyId: args.instantlyId,
      eaccount: args.eaccount,
    });
    return true;
  },
});

/** Keyword categorization; refined by AI later. */
function categorize(
  subject: string,
  body: string,
): "interested" | "not_interested" | "out_of_office" | "unsubscribed" | "other" {
  const text = `${subject} ${body}`.toLowerCase();
  if (/out of (the )?office|ooo|on vacation|annual leave|auto.?reply|autoreply/.test(text)) {
    return "out_of_office";
  }
  if (/unsubscribe|remove me|take me off|stop email/.test(text)) {
    return "unsubscribed";
  }
  if (/not interested|no thanks|no thank you|don'?t contact/.test(text)) {
    return "not_interested";
  }
  if (/interested|sounds good|tell me more|let'?s talk|book a call|schedule|pricing/.test(text)) {
    return "interested";
  }
  return "other";
}

// ── Analytics ───────────────────────────────────────────────────────────

export const analytics = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await currentWorkspace(ctx);
    if (!workspace) return null;
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const replies = await ctx.db
      .query("replies")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const contacted = new Set<string>();
    for (const campaign of campaigns) {
      const links = await ctx.db
        .query("campaignLeads")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
        .collect();
      for (const link of links) {
        if (link.status !== "queued") contacted.add(String(link.leadId));
      }
    }
    const totals = campaigns.reduce(
      (acc, c) => ({
        sent: acc.sent + (c.stats?.sent ?? 0),
        opened: acc.opened + (c.stats?.opened ?? 0),
        replied: acc.replied + (c.stats?.replied ?? 0),
        positive: acc.positive + (c.stats?.positive ?? 0),
      }),
      { sent: 0, opened: 0, replied: 0, positive: 0 },
    );
    return {
      totals,
      uniqueLeadsContacted: contacted.size,
      positiveReplies: replies.filter((r) => r.category === "interested").length,
      campaigns: campaigns.map((c) => ({
        _id: c._id,
        name: c.name,
        status: c.status,
        stats: c.stats ?? { sent: 0, opened: 0, replied: 0, positive: 0 },
      })),
    };
  },
});
