/**
 * Meeting types — one AI pass classifies each meeting and fills that type's
 * template sections. The same type is the meeting's "smart folder", so
 * templates and folders come from one decision (Read.ai keeps them apart).
 */

export const MEETING_TYPES = [
  "sales",
  "discovery",
  "one_on_one",
  "standup",
  "interview",
  "general",
] as const;

export type MeetingType = (typeof MEETING_TYPES)[number];

export type MeetingTemplate = {
  label: string;
  /** Shown on the smart folder + in the type picker. */
  description: string;
  /** Section headings the AI fills, in order (items = short bullets). */
  sections: { heading: string; guide: string }[];
  /** Tailwind classes for the type chip. */
  className: string;
};

export const MEETING_TEMPLATES: Record<MeetingType, MeetingTemplate> = {
  sales: {
    label: "Sales call",
    description: "Pitching or selling to a prospect or customer.",
    className: "bg-emerald-500/15 text-emerald-400",
    sections: [
      { heading: "Pain points", guide: "Problems the prospect described, in their words." },
      { heading: "Budget & timing", guide: "Any budget, pricing reaction or timeline mentioned." },
      { heading: "Decision makers", guide: "Who decides or signs, and who else must be involved." },
      { heading: "Objections", guide: "Concerns raised and how each was answered (or not)." },
      { heading: "Next step", guide: "The agreed next step and when." },
    ],
  },
  discovery: {
    label: "Discovery",
    description: "Learning a client's goals and requirements.",
    className: "bg-sky-500/15 text-sky-400",
    sections: [
      { heading: "Goals", guide: "What they want to achieve." },
      { heading: "Current setup", guide: "How they do it today and what's not working." },
      { heading: "Requirements", guide: "Must-haves and constraints." },
      { heading: "Risks & unknowns", guide: "What's unclear or could block it." },
    ],
  },
  one_on_one: {
    label: "1:1",
    description: "Two people: feedback, mentoring or alignment.",
    className: "bg-violet-500/15 text-violet-400",
    sections: [
      { heading: "Wins", guide: "What went well since last time." },
      { heading: "Blockers", guide: "What's in the way and who can help." },
      { heading: "Feedback", guide: "Feedback given in either direction." },
      { heading: "Growth", guide: "Goals, development or career topics." },
    ],
  },
  standup: {
    label: "Standup",
    description: "A team's quick status round.",
    className: "bg-amber-500/15 text-amber-400",
    sections: [
      {
        heading: "Updates by person",
        guide: "One bullet per person: 'Name — did …; doing …'.",
      },
      { heading: "Blockers", guide: "Each blocker with who raised it." },
    ],
  },
  interview: {
    label: "Interview",
    description: "Hiring: assessing a candidate.",
    className: "bg-pink-500/15 text-pink-400",
    sections: [
      { heading: "Candidate background", guide: "Experience and context they shared." },
      { heading: "Strengths", guide: "Evidence-backed strengths." },
      { heading: "Concerns", guide: "Gaps or doubts, with the evidence." },
      { heading: "Recommendation", guide: "Only if the interviewers stated one; else what's left to assess." },
    ],
  },
  general: {
    label: "General",
    description: "Anything else — team syncs, reviews, planning.",
    className: "bg-secondary text-muted-foreground",
    sections: [],
  },
};

export function isMeetingType(value: unknown): value is MeetingType {
  return typeof value === "string" && (MEETING_TYPES as readonly string[]).includes(value);
}

export function meetingTypeLabel(value: string | null | undefined): string {
  return isMeetingType(value) ? MEETING_TEMPLATES[value].label : "General";
}

/** The template part of the notes prompt. `forced` = a person picked the type. */
export function templatePrompt(forced: MeetingType | null): string {
  const lines = [
    "- meetingType: classify the meeting as one of: " +
      MEETING_TYPES.map((t) => `${t} (${MEETING_TEMPLATES[t].description})`).join("; ") +
      ".",
    "- templateSections: fill the sections for that type, in order, with " +
      "short bullets (heading exactly as given; empty items if nothing was said):",
  ];
  for (const type of MEETING_TYPES) {
    const { sections } = MEETING_TEMPLATES[type];
    lines.push(
      `  ${type}: ${
        sections.length === 0
          ? "no sections (return [])"
          : sections.map((s) => `"${s.heading}" — ${s.guide}`).join(" | ")
      }`,
    );
  }
  if (forced) {
    lines.push(
      `The user has said this meeting is a ${forced} — use meetingType "${forced}" and its sections.`,
    );
  }
  return lines.join("\n");
}
