/**
 * Definitions for the six service request forms. Shared by the client
 * renderer and the Convex backend (validation + sensitive-field handling).
 * Icons are name strings mapped to lucide components client-side.
 */

export type FormFieldDef = {
  name: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "url"
    | "email"
    | "tel"
    | "number"
    | "password"
    | "file"
    | "toggle"
    | "select";
  required?: boolean;
  placeholder?: string;
  helper?: string;
  /** Choices for type "select". */
  options?: string[];
  /** Highlighted info box rendered under the field. */
  callout?: { title: string; lines: string[] };
  /** Encrypted at rest; masked in the admin panel. */
  sensitive?: boolean;
  rows?: number;
  /** Toggle default. */
  defaultValue?: boolean;
  /** Render side by side with the next field on desktop. */
  half?: boolean;
};

export type FormDef = {
  slug: string;
  title: string;
  formTitle: string;
  category: string;
  description: string;
  icon: string;
  fields: FormFieldDef[];
  submitLabel?: string;
};

const IG_CREDENTIAL_FIELDS: FormFieldDef[] = [
  {
    name: "igUsername",
    label: "Instagram username",
    type: "text",
    required: true,
    placeholder: "@username",
  },
  {
    name: "igPassword",
    label: "Instagram password",
    type: "password",
    required: true,
    placeholder: "••••••••",
    helper: "Confidential: Only used for automated messaging.",
    sensitive: true,
  },
  {
    name: "backupCodes",
    label: "Backup codes",
    type: "textarea",
    placeholder: "Enter 8-digit codes (comma separated)",
    rows: 3,
    sensitive: true,
    callout: {
      title: "How to find backup codes",
      lines: [
        "Settings & Privacy → Accounts Center → Password & Security → 2FA → Instagram → Additional Methods → Backup Codes",
      ],
    },
  },
];

const ENGAGEMENT_TOGGLES: FormFieldDef[] = [
  {
    name: "allowFollowing",
    label: "Allow following for better response rate?",
    type: "toggle",
    defaultValue: true,
  },
  {
    name: "communityEngagement",
    label: "Enable free community engagement service?",
    type: "toggle",
    defaultValue: true,
    helper:
      "This helps boost your exposure and activity on Instagram by engaging with community members.",
  },
];

export const FORM_DEFS: FormDef[] = [
  {
    slug: "design-my-posts",
    title: "Content Creation",
    formTitle: "Design My Posts",
    category: "Content",
    icon: "Palette",
    description:
      "On-brand designs ready to post. Our team reviews every request and starts once payment is confirmed.",
    fields: [
      {
        name: "designTexts",
        label: "Text for each design (numbered list)",
        type: "textarea",
        required: true,
        placeholder: "1. Text for first post\n2. Text for second post…",
        rows: 5,
      },
      {
        name: "designExamples",
        label: "Design examples / similar styles",
        type: "textarea",
        placeholder: "Describe styles or link to examples you like.",
        rows: 4,
      },
      {
        name: "brandColors",
        label: "Brand colors",
        type: "text",
        required: true,
        placeholder: "Primary colors to use.",
      },
      {
        name: "driveLink",
        label: "Google Drive link (labeled pictures)",
        type: "url",
        placeholder: "https://drive.google.com/…",
        helper: "Label pictures by numbers for each individual design (1, 2, 3 etc).",
      },
      {
        name: "logo",
        label: "Upload company logo (PNG/JPG)",
        type: "file",
      },
    ],
  },
  {
    slug: "press-articles",
    title: "Press Articles",
    formTitle: "Press Articles Form",
    category: "PR",
    icon: "Newspaper",
    description:
      "Get your business featured. Tell us the story and we'll write and place the article — our team reviews every request and starts once payment is confirmed.",
    submitLabel: "Submit Request",
    fields: [
      {
        name: "story",
        label: "Story / Announcement",
        type: "textarea",
        required: true,
        placeholder: "What's the story? Launch, milestone, award, founder journey…",
        rows: 4,
      },
      {
        name: "targetAudience",
        label: "Target audience",
        type: "text",
        required: true,
        placeholder: "Who should read this?",
        half: true,
      },
      {
        name: "tone",
        label: "Tone / Style",
        type: "text",
        placeholder: "Authoritative, human-interest, technical…",
        half: true,
      },
      {
        name: "publications",
        label: "Publications or example articles",
        type: "textarea",
        placeholder: "Links to outlets you'd love to be in, or articles whose style you like",
        rows: 3,
      },
      {
        name: "keywords",
        label: "Keywords to include",
        type: "text",
        placeholder: "Brand name, product, location…",
      },
    ],
  },
  {
    slug: "customized-website",
    title: "Customized Website",
    formTitle: "Build Me a Website",
    category: "Onboarding",
    icon: "Globe",
    description:
      "Tell us what you need — our team reviews every request and starts once payment is confirmed.",
    fields: [
      {
        name: "projectTitle",
        label: "Project title",
        type: "text",
        required: true,
        placeholder: "My New Business Website",
      },
      {
        name: "driveFolder",
        label: "Google Drive folder link",
        type: "url",
        placeholder: "https://drive.google.com/…",
      },
      {
        name: "logo",
        label: "Upload company logo (PNG/JPG)",
        type: "file",
        callout: {
          title: "Include the following in Drive:",
          lines: [
            "Pictures for the website",
            "Google Doc with specific packages",
            "List of services in those packages",
          ],
        },
      },
      {
        name: "aboutUs",
        label: "About us / team summary",
        type: "textarea",
        required: true,
        placeholder: "A summary we can place on the About Us page.",
        rows: 5,
      },
      {
        name: "features",
        label: "Must-have features",
        type: "textarea",
        required: true,
        placeholder: "Contact form, booking system, e-commerce, etc.",
        rows: 3,
      },
      {
        name: "brandElements",
        label: "Brand elements",
        type: "textarea",
        placeholder: "Colors, specific fonts, imagery style, etc.",
        rows: 3,
      },
    ],
  },
  {
    slug: "get-real-estate-clients",
    title: "Get Real Estate Clients",
    formTitle: "Get Real Estate Clients",
    category: "Outreach",
    icon: "Building2",
    description:
      "Instagram outreach for realtors — our team reviews every request and starts once payment is confirmed.",
    fields: [
      ...IG_CREDENTIAL_FIELDS,
      {
        name: "idealClient",
        label: "Ideal client description",
        type: "textarea",
        required: true,
        placeholder: "Age range, profession, income, buying motivations…",
        rows: 4,
      },
      {
        name: "targetLocations",
        label: "Target locations (cities/zips)",
        type: "textarea",
        required: true,
        placeholder: "New York, 90210, Beverly Hills…",
        rows: 3,
      },
      ...ENGAGEMENT_TOGGLES,
    ],
  },
  {
    slug: "get-more-customers",
    title: "Get More Customers (Instagram)",
    formTitle: "Get More Customers (Instagram)",
    category: "Outreach",
    icon: "Instagram",
    description:
      "Instagram outreach for any business — our team reviews every request and starts once payment is confirmed.",
    fields: [
      ...IG_CREDENTIAL_FIELDS,
      {
        name: "idealClient",
        label: "Ideal client description",
        type: "textarea",
        required: true,
        placeholder: "Age range, profession, income, buying motivations…",
        rows: 4,
      },
      {
        name: "targetAccounts",
        label: "10 target accounts (@handles)",
        type: "textarea",
        required: true,
        placeholder: "@competitor1\n@competitor2…",
        rows: 4,
      },
      ...ENGAGEMENT_TOGGLES,
    ],
  },
  {
    slug: "reach-thousands",
    title: "Reach Thousands at Once",
    formTitle: "Reach Thousands at Once",
    category: "Outreach",
    icon: "Megaphone",
    description:
      "Mass Instagram DM campaigns — our team reviews every request and starts once payment is confirmed.",
    fields: [
      {
        name: "igUsername",
        label: "Instagram username (destination)",
        type: "text",
        required: true,
        placeholder: "@yourhandle",
      },
      {
        name: "dmCount",
        label: "How many DMs?",
        type: "number",
        required: true,
        placeholder: "10,000",
        half: true,
      },
      {
        name: "phone",
        label: "Phone number",
        type: "tel",
        placeholder: "+1…",
        half: true,
      },
      {
        name: "email",
        label: "Email",
        type: "email",
        required: true,
        placeholder: "your@email.com",
      },
      {
        name: "targetAccounts",
        label: "Ideal target accounts (vertical list)",
        type: "textarea",
        required: true,
        placeholder: "@handle1\n@handle2\n@handle3…",
        rows: 5,
        helper: "Note: Please select accounts with <10k followers for best results.",
      },
      {
        name: "outreachMessage",
        label: "Ideal outreach message",
        type: "textarea",
        required: true,
        placeholder: "Write your draft here. We will touch it up for best conversion.",
        rows: 5,
      },
      {
        name: "comments",
        label: "Questions and comments",
        type: "textarea",
        placeholder: "Any specific instructions or questions for the team?",
        rows: 4,
      },
    ],
  },
  {
    slug: "seo-fix-request",
  title: "Fix My SEO",
  formTitle: "SEO & AI Visibility Fix Request",
  category: "SEO",
  icon: "ScanSearch",
  description:
    "Our team fixes the issues from your audit — request a quote and we'll reach out with a plan and pricing.",
  submitLabel: "Request quote",
  fields: [
    {
      name: "website",
      label: "Website",
      type: "text",
      required: true,
      placeholder: "yourbrand.com",
    },
    {
      name: "auditSummary",
      label: "Audit findings to fix",
      type: "textarea",
      rows: 8,
      placeholder: "Paste or keep the findings from your audit…",
    },
    {
      name: "phone",
      label: "Phone (optional — for a faster callback)",
      type: "tel",
      placeholder: "+1…",
    },
    {
      name: "notes",
      label: "Anything else we should know",
      type: "textarea",
      rows: 3,
      placeholder: "Budget, timeline, priorities…",
    },
  ],
  },
  {
    slug: "comment-engagement",
    title: "Boost My Comments",
    formTitle: "Comment Engagement Service",
    category: "Engagement",
    icon: "MessagesSquare",
    description:
      "Our team drops on-brand comments across your posts and target links — in your exact voice, at your pace.",
    submitLabel: "Start comment service",
    fields: [
      {
        name: "igHandle",
        label: "Your handle",
        type: "text",
        required: true,
        placeholder: "@yourbrand",
        half: true,
      },
      {
        name: "niche",
        label: "Your niche / industry",
        type: "text",
        required: true,
        placeholder: "Med spa, real estate, fitness…",
        half: true,
      },
      {
        name: "tone",
        label: "Comment tone",
        type: "select",
        required: true,
        options: [
          "Friendly & casual",
          "Professional & polished",
          "Witty & playful",
          "Hype & energetic",
          "Supportive & warm",
        ],
        half: true,
      },
      {
        name: "length",
        label: "Comment length",
        type: "select",
        required: true,
        options: [
          "Short — a few words",
          "Medium — 1–2 sentences",
          "Long — 2+ sentences",
        ],
        half: true,
      },
      {
        name: "emojiLevel",
        label: "Emoji usage",
        type: "select",
        required: true,
        options: ["No emojis", "A few emojis 👍", "Emoji-heavy 🔥"],
        half: true,
      },
      {
        name: "likedExamples",
        label: "Comments you love (3–5 examples)",
        type: "textarea",
        required: true,
        rows: 5,
        placeholder:
          "Paste real comments whose style you want us to match — from any account",
        helper:
          "The most useful thing you can give us — we mirror this voice exactly.",
      },
      {
        name: "avoidList",
        label: "Never say / avoid",
        type: "textarea",
        rows: 3,
        placeholder: "Words, phrases, topics, or styles we must never use",
      },
      {
        name: "notes",
        label: "Anything else?",
        type: "textarea",
        rows: 3,
        placeholder: "Posting schedule, product launches coming up, priorities…",
      },
    ],
  },
];

export function getFormDef(slug: string): FormDef | undefined {
  return FORM_DEFS.find((f) => f.slug === slug);
}
