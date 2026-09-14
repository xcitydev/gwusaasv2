import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const adminRoleValidator = v.union(
  v.literal("regular"),
  v.literal("dev"),
  v.literal("super"),
);

export const planValidator = v.union(
  v.literal("free"),
  v.literal("personal"),
  v.literal("team"),
);

export default defineSchema({
  // ── Core ────────────────────────────────────────────────────────────────
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    adminRole: v.optional(adminRoleValidator),
    status: v.union(v.literal("active"), v.literal("locked")),
    referralCode: v.string(),
    referredBy: v.optional(v.id("users")),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_referral_code", ["referralCode"]),

  workspaces: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    plan: planValidator,
    credits: v.number(),
    // Guards against granting plan credits twice for the same plan purchase.
    planCreditsGrantedFor: v.optional(planValidator),
    // Outreach settings
    forwardRepliesTo: v.optional(v.string()),
  }).index("by_owner", ["ownerId"]),

  members: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  invites: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),
    token: v.string(),
    invitedBy: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
    ),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_token", ["token"])
    .index("by_email", ["email"]),

  config: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  creditLedger: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.optional(v.id("users")),
    amount: v.number(),
    balanceAfter: v.number(),
    feature: v.string(),
    description: v.string(),
    meta: v.optional(v.any()),
  }).index("by_workspace", ["workspaceId"]),

  purchases: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    kind: v.union(
      v.literal("topup"),
      v.literal("phone_number"),
      v.literal("domain"),
      v.literal("prewarmed_inbox"),
      v.literal("subscription"),
    ),
    amountUsd: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("refunded"),
    ),
    meta: v.optional(v.any()),
  }).index("by_workspace", ["workspaceId"]),

  referrals: defineTable({
    referrerUserId: v.id("users"),
    referredUserId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("qualified"),
      v.literal("paid"),
    ),
    plan: v.optional(planValidator),
    payoutUsd: v.optional(v.number()),
  })
    .index("by_referrer", ["referrerUserId"])
    .index("by_referred", ["referredUserId"]),

  notifications: defineTable({
    userId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    type: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    href: v.optional(v.string()),
    read: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "read"]),

  // ── Forms (phase 2) ─────────────────────────────────────────────────────
  formSubmissions: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    formSlug: v.string(),
    // Field name → value. Sensitive fields hold {encrypted: base64} instead.
    data: v.any(),
    files: v.optional(
      v.array(v.object({ field: v.string(), storageId: v.id("_storage"), name: v.string() })),
    ),
    status: v.union(
      v.literal("processing"),
      v.literal("active"),
      v.literal("closed"),
    ),
    statusChangedBy: v.optional(v.id("users")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_status", ["status"])
    .index("by_user", ["userId"]),

  // ── Tickets (phase 2) ───────────────────────────────────────────────────
  tickets: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    subject: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("answered"),
      v.literal("closed"),
    ),
    lastMessageAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_status", ["status"])
    .index("by_user", ["userId"]),

  ticketMessages: defineTable({
    ticketId: v.id("tickets"),
    authorId: v.optional(v.id("users")),
    isAdmin: v.boolean(),
    // "message" is a reply; "event" is e.g. "Admin X joined the ticket".
    kind: v.union(v.literal("message"), v.literal("event")),
    body: v.string(),
  }).index("by_ticket", ["ticketId"]),

  // ── Leads (phase 3) ─────────────────────────────────────────────────────
  leads: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),
    name: v.optional(v.string()),
    company: v.optional(v.string()),
    title: v.optional(v.string()),
    phone: v.optional(v.string()),
    location: v.optional(v.string()),
    industry: v.optional(v.string()),
    website: v.optional(v.string()),
    source: v.string(), // "csv" | "search" | provider name
    // Human attribution: the search query or campaign this lead came from.
    sourceDetail: v.optional(v.string()),
    extra: v.optional(v.any()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_email", ["workspaceId", "email"]),

  leadSearches: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    query: v.string(),
    filters: v.any(),
    resultCount: v.number(),
    // Which provider ran this search ("google_maps" | "linkedin" | "explorium"
    // | "realtor_agents" | "sample").
    source: v.optional(v.string()),
    // Async job state; missing on legacy rows = done.
    status: v.optional(
      v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
    ),
    apifyRunId: v.optional(v.string()),
    // FoundLead[] with per-row duplicate/noEmail flags; capped at 200.
    results: v.optional(v.any()),
    error: v.optional(v.string()),
    // Non-fatal problem (e.g. enrichment failed) shown above the results.
    warning: v.optional(v.string()),
    sample: v.optional(v.boolean()),
    creditCostPerLead: v.optional(v.number()),
    // Requested lead count; results storage + dataset fetch respect it.
    limit: v.optional(v.number()),
  }).index("by_workspace", ["workspaceId"]),

  // ── Outreach (phase 4) ──────────────────────────────────────────────────
  inboxes: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(),
    provider: v.union(
      v.literal("google"),
      v.literal("outlook"),
      v.literal("imap_smtp"),
      v.literal("prewarmed"),
    ),
    status: v.union(
      v.literal("connecting"),
      v.literal("warming"),
      v.literal("warmed"),
      v.literal("error"),
    ),
    dailyLimit: v.number(),
    // Warmup on/off (undefined = on). Synced to Instantly when live.
    warmupEnabled: v.optional(v.boolean()),
    // 0–100 deliverability health, synced from Instantly warmup analytics.
    healthScore: v.optional(v.number()),
    // True once the account exists in Instantly.
    engineConnected: v.optional(v.boolean()),
    // Last registration/sync error from the engine, for the UI.
    lastEngineError: v.optional(v.string()),
    // Warmup state as confirmed by Instantly on the last sync.
    engineWarmupActive: v.optional(v.boolean()),
    // Warmup email volume from Instantly analytics.
    warmupSentTotal: v.optional(v.number()),
    warmupSentLastDay: v.optional(v.number()),
    // IMAP/SMTP credentials are stored encrypted.
    credentials: v.optional(v.any()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_email", ["workspaceId", "email"]),

  emailDomains: defineTable({
    workspaceId: v.id("workspaces"),
    domain: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("error"),
    ),
    redirectTarget: v.optional(v.string()),
    registrar: v.optional(v.string()),
  }).index("by_workspace", ["workspaceId"]),

  campaigns: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("completed"),
    ),
    // Sending schedule
    sendWindowStart: v.string(), // "09:00"
    sendWindowEnd: v.string(), // "17:00"
    timezone: v.string(),
    dailyCap: v.number(),
    inboxIds: v.array(v.id("inboxes")),
    instantlyId: v.optional(v.string()),
    stats: v.optional(
      v.object({
        sent: v.number(),
        opened: v.number(),
        replied: v.number(),
        positive: v.number(),
      }),
    ),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_instantly_id", ["instantlyId"]),

  sequenceSteps: defineTable({
    campaignId: v.id("campaigns"),
    order: v.number(),
    waitDays: v.number(),
    subject: v.string(),
    // First entry is the main script; the rest are A/B variations.
    variants: v.array(v.string()),
  }).index("by_campaign", ["campaignId"]),

  campaignLeads: defineTable({
    campaignId: v.id("campaigns"),
    leadId: v.id("leads"),
    status: v.union(
      v.literal("queued"),
      v.literal("contacted"),
      v.literal("replied"),
      v.literal("unsubscribed"),
    ),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_lead", ["leadId"])
    .index("by_campaign_lead", ["campaignId", "leadId"]),

  replies: defineTable({
    workspaceId: v.id("workspaces"),
    campaignId: v.optional(v.id("campaigns")),
    leadEmail: v.string(),
    fromName: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    category: v.union(
      v.literal("interested"),
      v.literal("not_interested"),
      v.literal("out_of_office"),
      v.literal("unsubscribed"),
      v.literal("other"),
    ),
    read: v.boolean(),
    receivedAt: v.number(),
    instantlyId: v.optional(v.string()),
    // The inbox (email account) that received this reply — needed to reply.
    eaccount: v.optional(v.string()),
    // Outbound rows are replies WE sent, threaded under the inbound message.
    direction: v.optional(v.union(v.literal("inbound"), v.literal("outbound"))),
    inReplyTo: v.optional(v.id("replies")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_category", ["workspaceId", "category"])
    .index("by_campaign", ["campaignId"])
    .index("by_instantly_id", ["instantlyId"])
    .index("by_in_reply_to", ["inReplyTo"]),

  // ── Create with AI + AI tools (phase 5) ────────────────────────────────
  generations: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    kind: v.union(v.literal("image"), v.literal("video"), v.literal("edit")),
    model: v.string(),
    prompt: v.string(),
    params: v.any(), // resolution, duration, references…
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    costCredits: v.number(),
    resultUrl: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    error: v.optional(v.string()),
  }).index("by_workspace", ["workspaceId"]),

  // Admin-curated carousel design systems — same token shape as the built-in
  // templates in lib/carousel-templates.ts; users pick them from the library.
  carouselTemplates: defineTable({
    name: v.string(),
    tagline: v.string(),
    fontsUrl: v.string(),
    display: v.object({
      family: v.string(),
      weight: v.number(),
      transform: v.union(v.literal("uppercase"), v.literal("none")),
      letterSpacing: v.string(),
      sizeFactor: v.number(),
    }),
    bodyFamily: v.string(),
    monoFamily: v.string(),
    dark: v.boolean(),
    colors: v.object({
      ink: v.string(),
      surface: v.string(),
      line: v.string(),
      text: v.string(),
      muted: v.string(),
      accent: v.string(),
      accentBright: v.string(),
      accentDeep: v.string(),
      accent2: v.string(),
    }),
    artDirection: v.string(),
    bgModelId: v.string(),
    published: v.boolean(),
    createdBy: v.id("users"),
  }),

  carousels: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    topic: v.string(),
    brand: v.optional(v.string()),
    vibe: v.optional(v.string()),
    // Template mode: which design system renders the slides (undefined = classic
    // "ai-art" mode where the image model paints text too).
    templateId: v.optional(v.string()),
    // draft = plan written, nothing charged yet; running = backgrounds rendering
    status: v.union(
      v.literal("draft"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    caption: v.optional(v.string()),
    hashtags: v.optional(v.array(v.string())),
    // Classic mode: full slide images with text baked in.
    slides: v.optional(
      v.array(
        v.object({
          heading: v.string(),
          body: v.string(),
          imagePrompt: v.string(),
          imageUrl: v.optional(v.string()),
        }),
      ),
    ),
    // Template mode: structured deck — copy fields rendered as real HTML type
    // over AI background scenes (bgUrl), exported client-side as PNGs.
    deck: v.optional(
      v.array(
        v.object({
          type: v.string(),
          kicker: v.optional(v.string()),
          headline: v.optional(v.string()),
          dek: v.optional(v.string()),
          items: v.optional(
            v.array(v.object({ title: v.string(), body: v.string() })),
          ),
          stat: v.optional(v.string()),
          statLabel: v.optional(v.string()),
          quote: v.optional(v.string()),
          attribution: v.optional(v.string()),
          keyword: v.optional(v.string()),
          keywordLabel: v.optional(v.string()),
          cta: v.optional(v.string()),
          imagePrompt: v.string(),
          bgUrl: v.optional(v.string()),
        }),
      ),
    ),
    costCredits: v.number(),
    error: v.optional(v.string()),
  }).index("by_workspace", ["workspaceId"]),

  audits: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    target: v.string(), // website URL or business description
    status: v.union(
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    // { summary, seoFindings[], aiVisibilityFindings[], recommendations[], competitors[] }
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  }).index("by_workspace", ["workspaceId"]),

  transcripts: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    sourceType: v.union(v.literal("upload"), v.literal("link")),
    source: v.string(), // filename or URL
    storageId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    text: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_workspace", ["workspaceId"]),

  // ── Voice (phase 6) ─────────────────────────────────────────────────────
  receptionists: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    prompt: v.string(),
    voice: v.string(),
    // Bland ambiance: office / cafe / restaurant / none (null = phone static).
    backgroundTrack: v.optional(v.string()),
    greeting: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("live")),
    blandId: v.optional(v.string()),
    phoneNumberId: v.optional(v.id("phoneNumbers")),
    // Auto-scheduling: bookings extracted from calls are created on Cal.com.
    // Users just paste their public booking link — no API key needed.
    autoBook: v.optional(v.boolean()),
    calcomLink: v.optional(v.string()),
    calcomUsername: v.optional(v.string()),
    calcomEventSlug: v.optional(v.string()),
    bookingTimezone: v.optional(v.string()),
    // Legacy key-based config, still honored when present.
    calcomKeyEncrypted: v.optional(v.string()),
    calcomEventTypeId: v.optional(v.string()),
  }).index("by_workspace", ["workspaceId"]),

  phoneNumbers: defineTable({
    workspaceId: v.id("workspaces"),
    number: v.string(),
    provider: v.string(),
    monthlyCostUsd: v.number(),
    status: v.union(v.literal("active"), v.literal("released")),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_number", ["number"]),

  qualifierCampaigns: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    prompt: v.string(),
    // How the AI introduces itself on calls ("Hi, this is Maya…").
    callerName: v.optional(v.string()),
    voice: v.optional(v.string()),
    // Bland ambiance: office / cafe / restaurant / none (null = phone static).
    backgroundTrack: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("running"),
      v.literal("completed"),
    ),
    leadCount: v.number(),
  }).index("by_workspace", ["workspaceId"]),

  calls: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.union(v.literal("receptionist"), v.literal("qualifier")),
    receptionistId: v.optional(v.id("receptionists")),
    qualifierCampaignId: v.optional(v.id("qualifierCampaigns")),
    leadId: v.optional(v.id("leads")),
    fromNumber: v.optional(v.string()),
    durationSec: v.number(),
    costCredits: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    transcript: v.optional(v.string()),
    // AI analysis: summary, caller info, booking details, qualifier outcome.
    result: v.optional(v.any()),
    // Bland's call id — lets us fetch transcripts for browser test sessions.
    blandCallId: v.optional(v.string()),
    // Browser tests are recorded but never billed.
    isTest: v.optional(v.boolean()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_qualifier_campaign", ["qualifierCampaignId"])
    .index("by_bland_call", ["blandCallId"]),
});
