/**
 * Shared IG DM constants — the inbox UI and the Convex backend both import
 * these, so labels, colors and option lists live in exactly one place.
 */

export const AMBIANCE_OPTIONS = [
  { value: "none", label: "No background" },
  { value: "room", label: "Room tone — quiet, natural" },
  { value: "office", label: "Office — soft hum, faint typing" },
  { value: "cafe", label: "Cafe — murmur, the odd clink" },
] as const;

export type Ambiance = (typeof AMBIANCE_OPTIONS)[number]["value"];

export function isAmbiance(value: string): value is Ambiance {
  return AMBIANCE_OPTIONS.some((o) => o.value === value);
}

/** Voice notes are capped so a note stays under roughly a minute. */
export const VOICE_NOTE_MAX_CHARS = 800;

export const IG_PRIORITIES = {
  hot: { label: "Hot", dot: "bg-red-500", text: "text-red-400" },
  warm: { label: "Warm", dot: "bg-amber-400", text: "text-amber-400" },
  cold: { label: "Cold", dot: "bg-slate-500", text: "text-slate-400" },
} as const;

export type IgPriority = keyof typeof IG_PRIORITIES;

export const PRIORITY_RANK: Record<IgPriority, number> = {
  hot: 0,
  warm: 1,
  cold: 2,
};

export const IG_STAGES = {
  new: { label: "New", className: "bg-secondary text-muted-foreground" },
  qualified: {
    label: "Qualified",
    className: "bg-emerald-500/15 text-emerald-400",
  },
  booking_ready: {
    label: "Booking-ready",
    className: "bg-primary/15 text-primary",
  },
  customer: { label: "Customer", className: "bg-sky-500/15 text-sky-400" },
  not_fit: {
    label: "Not a fit",
    className: "bg-destructive/15 text-destructive",
  },
} as const;

export type IgStage = keyof typeof IG_STAGES;
