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

// IG DM triage — set by AI on every inbound, editable by hand.
export const igPriorityValidator = v.union(
  v.literal("hot"),
  v.literal("warm"),
  v.literal("cold"),
);
// AI Note Taker: one bot's life, scheduled → done.
export const meetingStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("joining"),
  v.literal("waiting_room"),
  v.literal("recording"),
  v.literal("processing"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const igStageValidator = v.union(
  v.literal("new"),
  v.literal("qualified"),
  v.literal("booking_ready"),
  v.literal("customer"),
  v.literal("not_fit"),
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
    // GWU Onboarding Forms are invite-only: unlocked by redeeming an invite
    // code or by an admin grant. Admins always have access (see lib/auth).
    formsAccess: v.optional(v.boolean()),
    formsAccessSource: v.optional(v.union(v.literal("invite"), v.literal("admin"))),
    formsAccessAt: v.optional(v.number()),
    formsInviteCodeId: v.optional(v.id("inviteCodes")),
    // Plan prices stay off the public site: new sign-ups answer a short quiz
    // at /welcome that recommends a plan and reveals its price.
    planQuizPending: v.optional(v.boolean()),
    planQuiz: v.optional(
      v.object({
        audience: v.string(),
        teamSize: v.string(),
        goals: v.array(v.string()),
        recommended: planValidator,
        skipped: v.boolean(),
        at: v.number(),
      }),
    ),
    // Clickwrap: when (and which version of) the Terms + Privacy Policy this
    // user accepted. Set by legal.acceptTerms; see lib/legal TERMS_VERSION.
    termsAcceptedAt: v.optional(v.number()),
    termsVersion: v.optional(v.string()),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_referral_code", ["referralCode"])
    .index("by_admin_role", ["adminRole"]),

  workspaces: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    plan: planValidator,
    credits: v.number(),
    // Guards against granting plan credits twice for the same plan purchase.
    planCreditsGrantedFor: v.optional(planValidator),
    // The Whop subscription paying for this workspace's plan, if any.
    whopMembershipId: v.optional(v.string()),
    // Who set the current plan: a Whop payment, or a superadmin from
    // /admin/users. An admin-set plan survives a lapsed Whop membership; a
    // real payment takes the plan back over.
    planSource: v.optional(v.union(v.literal("whop"), v.literal("admin"))),
    planSetBy: v.optional(v.id("users")),
    planSetAt: v.optional(v.number()),
    planNote: v.optional(v.string()),
    // Outreach settings
    forwardRepliesTo: v.optional(v.string()),
    // Sender postal address printed in every campaign email (CAN-SPAM);
    // campaigns can't go live without it.
    postalAddress: v.optional(v.string()),
    /** Cached count of distinct leads enrolled in non-archived campaigns (platform pool). */
    outreachContacts: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_whop_membership", ["whopMembershipId"]),

  /**
   * Emails sent per workspace per calendar month, tallied from Instantly's
   * campaign analytics by the engine sync. Caps live in config.
   */
  outreachUsage: defineTable({
    workspaceId: v.id("workspaces"),
    month: v.string(), // "2026-10" (UTC)
    emailsSent: v.number(),
    pausedForCap: v.boolean(),
  })
    .index("by_workspace_month", ["workspaceId", "month"])
    .index("by_month", ["month"]),

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
    // Missing on legacy rows: those expire a week after _creationTime.
    expiresAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_token", ["token"])
    .index("by_email", ["email"]),

  // Codes that unlock the GWU Onboarding Forms (distinct from team invites).
  inviteCodes: defineTable({
    // Canonical: uppercase alphanumerics, no dashes (see lib/invite-codes.ts).
    code: v.string(),
    label: v.optional(v.string()),
    createdBy: v.id("users"),
    // Undefined = unlimited.
    maxUses: v.optional(v.number()),
    uses: v.number(),
    expiresAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("revoked")),
  }).index("by_code", ["code"]),

  // AI Hub chat: one thread per user per workspace (UI messages + the
  // plan-card → generation map so result cards survive a refresh).
  hubThreads: defineTable({
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    messages: v.any(),
    jobs: v.optional(v.any()),
    updatedAt: v.number(),
  }).index("by_user_workspace", ["userId", "workspaceId"]),

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
    // Whop payment behind this purchase — how refunds/disputes find it.
    whopPaymentId: v.optional(v.string()),
    // Credits granted by this payment (plan grant or top-up total).
    creditsGranted: v.optional(v.number()),
    // Cumulative USD refunded/disputed so far (partial refunds claw back the delta).
    refundedUsd: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_whop_payment", ["whopPaymentId"]),

  referrals: defineTable({
    referrerUserId: v.id("users"),
    referredUserId: v.id("users"),
    // pending → active on the first paid plan → churned when the referred
    // subscription dies. "qualified"/"paid" are legacy rows from the old
    // one-time payout scheme and keep their payoutUsd.
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("churned"),
      v.literal("qualified"),
      v.literal("paid"),
    ),
    plan: v.optional(planValidator),
    /** Legacy one-time payout (scheme before 2026-10-07). */
    payoutUsd: v.optional(v.number()),
    /** Rate locked at the referral's first payment, so a later config change never shrinks a promise. */
    commissionPercent: v.optional(v.number()),
    lifetimeUsd: v.optional(v.number()),
    paymentCount: v.optional(v.number()),
    lastPaymentAt: v.optional(v.number()),
    referredWorkspaceId: v.optional(v.id("workspaces")),
  })
    .index("by_referrer", ["referrerUserId"])
    .index("by_referred", ["referredUserId"]),

  /** One row per paid invoice of a referred workspace: the referrer's cut, for life. */
  referralCommissions: defineTable({
    referralId: v.id("referrals"),
    referrerUserId: v.id("users"),
    referredUserId: v.id("users"),
    whopPaymentId: v.string(),
    kind: v.union(v.literal("first"), v.literal("renewal")),
    plan: planValidator,
    paymentUsd: v.number(),
    percent: v.number(),
    amountUsd: v.number(),
    // pending → owed once the refund window passes (availableAt); void when
    // the payment is refunded/disputed or turns out to be a self-referral.
    status: v.union(
      v.literal("pending"),
      v.literal("owed"),
      v.literal("paid"),
      v.literal("void"),
    ),
    availableAt: v.optional(v.number()),
    voidReason: v.optional(v.string()),
    paidAt: v.optional(v.number()),
  })
    .index("by_referral", ["referralId"])
    .index("by_referrer", ["referrerUserId"])
    .index("by_payment", ["whopPaymentId"]),

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

  // Vendor/technical failures hidden from users (lib/public-errors.ts) —
  // grouped by fingerprint so a flapping provider is one row, not hundreds.
  incidents: defineTable({
    fingerprint: v.string(),
    area: v.string(),
    vendor: v.optional(v.string()),
    source: v.string(), // function name or job kind that failed
    message: v.string(), // raw text, admin-only
    userId: v.optional(v.id("users")),
    workspaceId: v.optional(v.id("workspaces")),
    count: v.number(),
    lastAt: v.number(),
    status: v.union(v.literal("open"), v.literal("resolved")),
  })
    .index("by_fingerprint_status", ["fingerprint", "status"])
    .index("by_status_last", ["status", "lastAt"]),

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
    // Leads that came instantly from the shared library (no scrape run).
    poolCount: v.optional(v.number()),
    // A "Find more" scrape is running on top of library results.
    extending: v.optional(v.boolean()),
  }).index("by_workspace", ["workspaceId"]),

  // ── Shared lead library ─────────────────────────────────────────────────
  // Every paid scrape lands here (deduped across all workspaces) so the next
  // matching search is served without running the scraper again.
  leadPool: defineTable({
    source: v.string(),
    // Real email, phone-derived key (lib/lead-keys) or name|company.
    dedupeKey: v.string(),
    email: v.string(),
    name: v.string(),
    company: v.string(),
    title: v.string(),
    location: v.string(),
    industry: v.string(),
    website: v.string(),
    phone: v.string(),
    // name + company + title + industry + location, for keyword matching.
    searchText: v.string(),
    scrapedAt: v.number(),
    // Where the row came from ("apify:google_maps", "apify:linkedin",
    // "explorium", …) — `source` is the search type. Older rows lack it.
    provider: v.optional(v.string()),
    // phoneLeadKey(phone), so a phone opt-out finds every row with that number.
    phoneKey: v.optional(v.string()),
  })
    .index("by_source_key", ["source", "dedupeKey"])
    .index("by_email", ["email"])
    .index("by_phone_key", ["phoneKey"])
    .index("by_scraped_at", ["scrapedAt"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["source"] }),

  // ── Privacy / anti-spam ─────────────────────────────────────────────────
  // Addresses that must never be emailed again through the platform.
  // Unsubscribes and public opt-outs are global (no workspaceId).
  emailSuppressions: defineTable({
    email: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
    reason: v.union(v.literal("unsubscribed"), v.literal("opt_out"), v.literal("manual")),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  // Public /opt-out requests: people asking to be removed from lead data.
  // Phone-only opt-outs are matched by phoneKey; the IG handle is recorded
  // for manual follow-up (the library has no IG handle column).
  dataOptOuts: defineTable({
    email: v.optional(v.string()),
    phoneKey: v.optional(v.string()),
    igHandle: v.optional(v.string()),
    removedRows: v.number(),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_phone_key", ["phoneKey"]),

  // Per-day submission counters for the public opt-out form ("global" plus
  // one per submitted identifier) — crude abuse protection.
  optOutRateLimits: defineTable({
    key: v.string(),
    day: v.string(), // "2026-10-28" (UTC)
    count: v.number(),
  }).index("by_key_day", ["key", "day"]),

  // Which library leads a given (normalized) search produced.
  leadPoolQueries: defineTable({
    source: v.string(),
    queryKey: v.string(),
    leadIds: v.array(v.id("leadPool")),
    scrapedAt: v.number(),
  }).index("by_source_query", ["source", "queryKey"]),

  // ── Instagram commenter scraper (Leads → IG Commenters) ────────────────
  // Two Apify runs per job: comment scraper (post → comments + usernames),
  // then profile scraper (usernames → bio, followers, link in bio).
  igCommentScrapes: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    postUrl: v.string(),
    // Max comments requested (1–500); also caps stored rows.
    limit: v.number(),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
    step: v.union(v.literal("comments"), v.literal("profiles")),
    apifyRunId: v.optional(v.string()),
    // Stage-1 output (IgComment[] deduped by username) kept until bios land.
    comments: v.optional(v.any()),
    commentCount: v.optional(v.number()),
    // Final IgCommenterRow[]: profile + the user's comment.
    results: v.optional(v.any()),
    resultCount: v.number(),
    // Effective credits per commenter (comment + profile rate) for the UI copy.
    creditCostPerProfile: v.number(),
    // Unit rates captured at start (×4.5 rule): billed on actual counts.
    creditRates: v.optional(v.object({ comment: v.number(), profile: v.number() })),
    creditsSpent: v.optional(v.number()),
    // Worst case spent up front at start; the unused part is refunded on
    // completion/failure. Absent on jobs from before reservations.
    creditsReserved: v.optional(v.number()),
    error: v.optional(v.string()),
    warning: v.optional(v.string()),
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
    // True only when this app created the engine account (not an existing
    // mailbox an admin linked), so removing the inbox may delete it there.
    engineCreatedByUs: v.optional(v.boolean()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_email", ["workspaceId", "email"])
    // The engine account is shared: an address may belong to one workspace only.
    .index("by_email", ["email"]),

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
      // Removed from Instantly; leads no longer count against the contact cap.
      v.literal("archived"),
    ),
    statusChangedAt: v.optional(v.number()),
    // Cumulative sent count already added to outreachUsage (engine sync).
    sentAccounted: v.optional(v.number()),
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
    kind: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("edit"),
      v.literal("motion"),
    ),
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
    // Which engine ran it; absent = fal (rows from before Studio existed).
    provider: v.optional(v.union(v.literal("fal"), v.literal("higgsfield"))),
    // Upstream job id — how a webhook finds its row.
    providerRequestId: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_provider_request", ["providerRequestId"]),

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
    // Which call engine answers: Bland (default) or an ElevenLabs agent on
    // a Twilio number. `elevenAgentId` is the agent synced from this row.
    engine: v.optional(v.union(v.literal("bland"), v.literal("elevenlabs"))),
    elevenAgentId: v.optional(v.string()),
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

  // ── IG DMs via GoHighLevel ────────────────────────────────────────────
  // Platform-wide GHL agency OAuth — one row per app. GHL splits powers:
  // "provisioner" (Agency-target app, locations.write) creates sub-accounts;
  // "messenger" (Sub-Account-target app) holds conversation scopes and mints
  // location tokens.
  ghlAuth: defineTable({
    role: v.union(v.literal("provisioner"), v.literal("messenger")),
    companyId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
  }).index("by_role", ["role"]),
  // One GHL location (sub-account) per workspace that enables IG DMs.
  igAccounts: defineTable({
    workspaceId: v.id("workspaces"),
    ghlLocationId: v.string(),
    locationToken: v.optional(v.string()),
    locationTokenExpiresAt: v.optional(v.number()),
    // Messenger installs are per-location (Location-class OAuth) — each
    // location keeps its own refresh token.
    locationRefreshToken: v.optional(v.string()),
    // Hidden GHL user for the location — the social OAuth start requires one.
    ghlUserId: v.optional(v.string()),
    status: v.union(v.literal("pending_connect"), v.literal("connected")),
    igUsername: v.optional(v.string()),
    // AI copilot. Autopilot = the AI sends replies itself (drafts-only when
    // off). The brief is the ONLY source of facts it may state — and the
    // guardrail: questions outside it get handed to a human.
    autopilot: v.optional(v.boolean()),
    aiBrief: v.optional(v.string()),
    bookingLink: v.optional(v.string()),
    // Last-used voice-note settings (Bland clone id + ambiance bed).
    voiceId: v.optional(v.string()),
    ambiance: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_location", ["ghlLocationId"]),
  // One-shot states an admin mints before the GHL agency install, so a
  // stray code can't overwrite the platform-wide ghlAuth.
  ghlOauthStates: defineTable({
    state: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
  // Voice-note renders we produced — the only blobs /crm/audio will serve.
  igVoiceNotes: defineTable({
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
  }).index("by_storage", ["storageId"]),
  igConversations: defineTable({
    workspaceId: v.id("workspaces"),
    ghlConversationId: v.string(),
    ghlContactId: v.string(),
    contactName: v.optional(v.string()),
    lastMessageAt: v.number(),
    lastPreview: v.optional(v.string()),
    unread: v.boolean(),
    // Who spoke last — "inbound" means the lead is waiting on us.
    lastDirection: v.optional(
      v.union(v.literal("inbound"), v.literal("outbound")),
    ),
    // AI triage (runs on every inbound message).
    priority: v.optional(igPriorityValidator),
    stage: v.optional(igStageValidator),
    nextAction: v.optional(v.string()),
    triagedAt: v.optional(v.number()),
    assigneeId: v.optional(v.id("users")),
    // Autopilot hit something outside its brief and stood down.
    needsHuman: v.optional(v.boolean()),
    needsHumanReason: v.optional(v.string()),
    // When the next coalesced triage run is due (webhook bursts share one).
    triageScheduledFor: v.optional(v.number()),
    // First autopilot message carried the AI-assistant disclosure.
    aiDisclosedAt: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId", "lastMessageAt"])
    .index("by_ghl", ["ghlConversationId"])
    .searchIndex("search_name", {
      searchField: "contactName",
      filterFields: ["workspaceId"],
    }),
  igMessages: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("igConversations"),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    body: v.string(),
    ghlMessageId: v.optional(v.string()),
    sentAt: v.number(),
    // Outbound attribution: a teammate or the AI copilot.
    sentBy: v.optional(v.union(v.literal("human"), v.literal("ai"))),
    senderId: v.optional(v.id("users")),
    // Voice notes: body holds the spoken script, audio lives in storage.
    kind: v.optional(v.union(v.literal("text"), v.literal("voice"))),
    audioStorageId: v.optional(v.id("_storage")),
  })
    .index("by_conversation", ["conversationId", "sentAt"])
    .searchIndex("search_body", {
      searchField: "body",
      filterFields: ["workspaceId"],
    }),

  // Voice clones live in the platform-wide Bland account — this table scopes
  // each clone to the workspace that recorded it (pickers filter on it).
  clonedVoices: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    voiceId: v.string(),
    name: v.string(),
    // Clone engine; absent = Bland (rows from before ElevenLabs existed).
    // ElevenLabs clones are TTS-only: previews + IG voice notes, not calls.
    provider: v.optional(v.union(v.literal("bland"), v.literal("elevenlabs"))),
    // When `userId` attested it's their voice or they hold the speaker's
    // written permission. Required for new clones; absent on legacy rows.
    consentAttestedAt: v.optional(v.number()),
    // ElevenLabs voice pool. The account caps saved voices per plan, so the
    // recording lives with us and the voice is loaded into ElevenLabs only
    // while in use: `voiceId` is our stable key ("elv_…"), `remoteVoiceId`
    // the ElevenLabs id while loaded. The least-recently-used voice is
    // unloaded when the pool is full and reloads on next use. Rows with no
    // sample (pre-pool) keep their ElevenLabs id in `voiceId`, pinned.
    sampleStorageId: v.optional(v.id("_storage")),
    remoteVoiceId: v.optional(v.string()),
    lastUsedAt: v.optional(v.number()),
    // Never unloaded before this time: a preview holds a voice ~1 minute, a
    // browser test or call holds it for its maximum length.
    busyUntil: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_voice", ["voiceId"])
    .index("by_provider", ["provider"]),

  phoneNumbers: defineTable({
    workspaceId: v.id("workspaces"),
    number: v.string(),
    // "bland" (bought through Bland) or "twilio" (bought on our Twilio
    // account and imported into ElevenLabs Agents).
    provider: v.string(),
    monthlyCostUsd: v.number(),
    status: v.union(v.literal("active"), v.literal("released")),
    twilioSid: v.optional(v.string()),
    elevenPhoneNumberId: v.optional(v.string()),
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
    // Who the AI says it's calling for (falls back to the workspace name).
    businessName: v.optional(v.string()),
    // Fallback IANA zone for the 9am–8pm calling window when a lead's
    // area code doesn't say where they are. Absent = America/New_York.
    timezone: v.optional(v.string()),
    // TCPA attestation (prior express written consent + DNC scrub), ticked
    // by `consentAttestedBy` before the campaign may dial.
    consentAttestedAt: v.optional(v.number()),
    consentAttestedBy: v.optional(v.id("users")),
    // Why a running campaign is waiting (calling hours, credits…).
    statusNote: v.optional(v.string()),
    // Call engine (Bland default) + the ElevenLabs agent dialing for it.
    engine: v.optional(v.union(v.literal("bland"), v.literal("elevenlabs"))),
    elevenAgentId: v.optional(v.string()),
  }).index("by_workspace", ["workspaceId"]),

  // Per-workspace internal do-not-call list. Leads who refuse or ask to be
  // removed land here; qualifier campaigns never dial these numbers.
  voiceOptOuts: defineTable({
    workspaceId: v.id("workspaces"),
    phone: v.string(), // E.164
    reason: v.string(),
    callId: v.optional(v.id("calls")),
    createdAt: v.number(),
  }).index("by_workspace_phone", ["workspaceId", "phone"]),

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
    // The engine's call id — Bland call_id, or the ElevenLabs conversation_id
    // when `engine` is "elevenlabs". Lets us fetch transcripts and dedupe.
    blandCallId: v.optional(v.string()),
    engine: v.optional(v.union(v.literal("bland"), v.literal("elevenlabs"))),
    // ElevenLabs browser tests: the throwaway agent the session talks to.
    elevenAgentId: v.optional(v.string()),
    // Browser tests are recorded but never billed.
    isTest: v.optional(v.boolean()),
    // A dispatcher has claimed this pending row (guards against double-dial
    // when two dispatch runs overlap).
    dispatchClaimedAt: v.optional(v.number()),
    // Credits the call cost but the balance couldn't cover (billed what was left).
    unbilledCredits: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_qualifier_campaign", ["qualifierCampaignId"])
    .index("by_bland_call", ["blandCallId"]),

  // ── AI Note Taker (Recall.ai meeting bots) ────────────────────────────
  noteTakerSettings: defineTable({
    workspaceId: v.id("workspaces"),
    botName: v.optional(v.string()),
    // Post a recording disclosure in the meeting chat when the bot joins.
    announce: v.optional(v.boolean()),
    // Recap email: whoever sent the bot, the invitees too, or nobody.
    recapAudience: v.optional(
      v.union(v.literal("host"), v.literal("attendees"), v.literal("none")),
    ),
    recapExtraEmails: v.optional(v.array(v.string())),
    // Recording + transcript lifetime at Recall (their retention timer).
    retentionDays: v.optional(v.number()),
    // Calendar events: record everything with a link, or pick by hand.
    autoJoin: v.optional(v.union(v.literal("all"), v.literal("manual"))),
    // Secret path token for the Cal.com booking webhook.
    calcomToken: v.optional(v.string()),
    // HMAC secret for X-Cal-Signature-256; enforced once a signed delivery
    // has been seen (calcomSecretVerified), so older setups keep working.
    calcomSecret: v.optional(v.string()),
    calcomSecretVerified: v.optional(v.boolean()),
    // Agenda Coach: live drift / timebox nudges during the call.
    coachEnabled: v.optional(v.boolean()),
    // Post nudges into the meeting chat (Zoom / Meet / Teams).
    coachChat: v.optional(v.boolean()),
    // Show the live coach card as the bot's camera feed.
    coachTile: v.optional(v.boolean()),
    // Minimum minutes between two chat nudges.
    coachNudgeMin: v.optional(v.number()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_calcom_token", ["calcomToken"]),

  // Calendars handed to Recall's Calendar V2 (it holds the refresh token).
  noteTakerCalendars: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    platform: v.union(
      v.literal("google_calendar"),
      v.literal("microsoft_outlook"),
    ),
    recallCalendarId: v.string(),
    email: v.optional(v.string()),
    status: v.union(v.literal("connected"), v.literal("disconnected")),
    // Cursor for incremental event sync (ISO timestamp).
    lastSyncedTs: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_recall_id", ["recallCalendarId"]),

  // One-shot CSRF states for the calendar OAuth round-trip.
  noteTakerOauthStates: defineTable({
    state: v.string(),
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    platform: v.union(
      v.literal("google_calendar"),
      v.literal("microsoft_outlook"),
    ),
  }).index("by_state", ["state"]),

  // Calendar grants waiting for the signed-in owner to confirm in-app (the
  // OAuth callback alone can't prove whose browser finished the consent).
  noteTakerPendingCalendars: defineTable({
    nonce: v.string(),
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    platform: v.union(
      v.literal("google_calendar"),
      v.literal("microsoft_outlook"),
    ),
    refreshTokenEncrypted: v.string(),
    expiresAt: v.number(),
  }).index("by_nonce", ["nonce"]),

  meetings: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    title: v.string(),
    // True until the user (or the calendar) names it — AI may retitle.
    autoTitle: v.optional(v.boolean()),
    meetingUrl: v.string(),
    platform: v.optional(v.string()),
    source: v.union(
      v.literal("manual"),
      v.literal("calendar"),
      v.literal("calcom"),
    ),
    // Calendar event id / Cal.com booking uid — one bot per real meeting.
    dedupKey: v.optional(v.string()),
    calendarId: v.optional(v.id("noteTakerCalendars")),
    recallEventId: v.optional(v.string()),
    recallBotId: v.optional(v.string()),
    status: meetingStatusValidator,
    statusDetail: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    costCredits: v.optional(v.number()),
    attendees: v.optional(
      v.array(v.object({ name: v.string(), email: v.optional(v.string()) })),
    ),
    // AI write-up (MeetingNotes) + talk-time stats (MeetingAnalytics).
    notes: v.optional(v.any()),
    notesStatus: v.optional(
      v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    ),
    analytics: v.optional(v.any()),
    // Title + summary + key points, flattened for the search index.
    searchText: v.optional(v.string()),
    recapSentAt: v.optional(v.number()),
    // Set once the recording is stored + billed (idempotency guard).
    finalizedAt: v.optional(v.number()),
    mediaDeleted: v.optional(v.boolean()),
    dispatchAttempts: v.optional(v.number()),
    pollCount: v.optional(v.number()),
    // Agenda Coach: the plan (items + minute budgets), the secret token the
    // real-time webhook and the public coach card use, and the live verdict.
    agenda: v.optional(v.array(v.object({ title: v.string(), minutes: v.number() }))),
    coachToken: v.optional(v.string()),
    // Write credential for /notes/realtime (separate from the public card
    // key). Absent on meetings created before it existed.
    realtimeToken: v.optional(v.string()),
    coachState: v.optional(v.any()),
    // Action items pushed to Trello / Asana / a webhook after the notes.
    taskRouting: v.optional(v.any()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_bot", ["recallBotId"])
    .index("by_dedup", ["workspaceId", "dedupKey"])
    .index("by_status", ["status"])
    .index("by_coach_token", ["coachToken"])
    .index("by_realtime_token", ["realtimeToken"])
    .searchIndex("search_meta", {
      searchField: "searchText",
      filterFields: ["workspaceId"],
    }),

  // The transcript, ~150 speaker segments per row: keeps `meetings` light
  // and lets a search hit point at the moment it was said.
  meetingTranscriptParts: defineTable({
    meetingId: v.id("meetings"),
    workspaceId: v.id("workspaces"),
    part: v.number(),
    segments: v.array(
      v.object({
        speaker: v.string(),
        start: v.number(),
        end: v.number(),
        text: v.string(),
      }),
    ),
    text: v.string(),
  })
    .index("by_meeting", ["meetingId", "part"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["workspaceId"],
    }),

  // Live transcript segments streamed by Recall during the call (the
  // Agenda Coach reads these; the final transcript still lands in
  // meetingTranscriptParts after the call).
  meetingLiveSegments: defineTable({
    meetingId: v.id("meetings"),
    workspaceId: v.id("workspaces"),
    speaker: v.string(),
    start: v.number(),
    end: v.number(),
    text: v.string(),
  }).index("by_meeting", ["meetingId", "start"]),

  // Every nudge the coach produced, and where it went.
  coachEvents: defineTable({
    meetingId: v.id("meetings"),
    workspaceId: v.id("workspaces"),
    at: v.number(),
    kind: v.union(
      v.literal("overrun"),
      v.literal("drift"),
      v.literal("balance"),
      v.literal("next"),
      v.literal("manual"),
      v.literal("tile"),
    ),
    message: v.string(),
    channels: v.array(v.string()),
  }).index("by_meeting", ["meetingId"]),

  // Task tools connected in Settings → Integrations. Secrets are encrypted.
  integrations: defineTable({
    workspaceId: v.id("workspaces"),
    provider: v.union(v.literal("trello"), v.literal("asana"), v.literal("webhook")),
    status: v.union(v.literal("connected"), v.literal("error")),
    label: v.optional(v.string()),
    secret: v.string(),
    // Provider target (board/list, workspace/project, url) — never secret.
    config: v.any(),
    autoRoute: v.boolean(),
    connectedBy: v.id("users"),
    updatedAt: v.number(),
    lastError: v.optional(v.string()),
  }).index("by_workspace_provider", ["workspaceId", "provider"]),

  // "Ask this meeting" conversation.
  meetingChats: defineTable({
    meetingId: v.id("meetings"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
  }).index("by_meeting", ["meetingId"]),

  // Whop webhook idempotency — one row per processed payment/event key.
  // Whop delivers at-least-once and retries for days; a replayed renewal
  // must never grant credits twice.
  whopEvents: defineTable({
    key: v.string(),
    type: v.string(),
  }).index("by_key", ["key"]),

  // Fixed-window rate limiter (convex/rateLimits.ts): one row per key
  // (e.g. "enhancePrompt:<userId>").
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // Guided product tours — where each user is in each walkthrough.
  // Who uploaded each storage file, so a storage id alone never grants
  // access (files.getPublicUrl, forms.submit check ownership).
  uploads: defineTable({
    storageId: v.id("_storage"),
    userId: v.id("users"),
    createdAt: v.number(),
  }).index("by_storage", ["storageId"]),

  tourProgress: defineTable({
    userId: v.id("users"),
    tourId: v.string(),
    step: v.number(),
    completedAt: v.optional(v.number()),
    skippedAt: v.optional(v.number()),
  }).index("by_user_tour", ["userId", "tourId"]),
});
