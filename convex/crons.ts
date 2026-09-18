import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Reconcile with Instantly: warmup health scores, unibox replies, campaign
// stats. A no-op until INSTANTLY_API_KEY is set on the deployment.
crons.interval(
  "sync email engine",
  { minutes: 15 },
  internal.outreachActions.syncEngine,
  {},
);

// Backfill inbound receptionist calls whose completion webhook was missed —
// without this a dropped webhook means no record, no analysis, no booking.
crons.interval(
  "sync inbound calls",
  { minutes: 15 },
  internal.voiceActions.syncInboundCalls,
  {},
);

// IG DMs safety net: API-pull recent conversations so messages arrive even
// if GHL's webhook misses (verified live: webhook config is fragile).
crons.interval(
  "sync ig dms",
  { minutes: 5 },
  internal.igDmsActions.syncAllIgAccounts,
  {},
);

export default crons;
