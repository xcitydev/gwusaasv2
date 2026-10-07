/**
 * Definitions for the service request and event forms. Shared by the client
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
    | "select"
    | "multiselect";
  required?: boolean;
  placeholder?: string;
  helper?: string;
  /** Choices for type "select" / "multiselect". */
  options?: string[];
  /** Maximum number of choices for type "multiselect" (stored comma-separated). */
  max?: number;
  /** Starts a new titled section; rendered as a heading above this field. */
  section?: { title: string; description?: string };
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
  /** Custom confirmation dialog; defaults to the paid-service "Processing" copy. */
  successTitle?: string;
  successBody?: string;
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
    slug: "mmc-iii-attendee-profile",
    title: "Miami Mastermind Conference III",
    formTitle: "MMC III Attendee Profile",
    category: "Events",
    icon: "CalendarDays",
    description:
      "December 12, 2026 · Miami. We're designing MMC III around both high-level education and the quality of the people in the room — this short profile helps us personalize your experience, plan hospitality and make more relevant introductions throughout the event.",
    submitLabel: "Submit profile",
    successTitle: "You're all set.",
    successBody:
      "Our team will use your responses to help shape networking, introductions, hospitality and programming for MMC III.\n\nDecember 12 · Miami. We look forward to having you in the room.",
    fields: [
      {
        name: "fullName",
        label: "Full name",
        type: "text",
        required: true,
        placeholder: "First and last name",
        section: { title: "About you" },
      },
      {
        name: "ticketEmail",
        label: "Email used to purchase your ticket",
        type: "email",
        required: true,
        placeholder: "you@company.com",
      },
      {
        name: "phone",
        label: "Phone number",
        type: "tel",
        placeholder: "+1…",
        half: true,
      },
      {
        name: "instagram",
        label: "Instagram",
        type: "text",
        placeholder: "@handle",
        half: true,
      },
      {
        name: "company",
        label: "Company / Brand",
        type: "text",
        required: true,
        half: true,
      },
      {
        name: "jobTitle",
        label: "Job title / Role",
        type: "text",
        required: true,
        half: true,
      },
      {
        name: "industry",
        label: "Which industry best describes what you do?",
        type: "text",
        required: true,
        placeholder: "Real estate, e-commerce, SaaS, media, consulting…",
      },
      {
        name: "companyDescription",
        label: "Briefly describe what you or your company does",
        type: "textarea",
        required: true,
        rows: 3,
      },
      {
        name: "stage",
        label: "What stage best describes your business or career?",
        type: "select",
        options: [
          "Pre-revenue / Starting",
          "Under $1M annual revenue",
          "$1M–$5M",
          "$5M–$10M",
          "$10M–$25M",
          "$25M–$50M",
          "$50M–$100M",
          "$100M+",
          "Investor",
          "Executive / Operator",
          "Creator / Personal Brand",
          "Other",
        ],
      },
      {
        name: "wantToMeet",
        label: "Who would you most like to meet at MMC III?",
        type: "textarea",
        required: true,
        rows: 3,
        section: {
          title: "Networking preferences",
          description: "Tell us who you want in your orbit so we can plan the right introductions.",
        },
      },
      {
        name: "networkingGoals",
        label: "What specifically are you hoping to accomplish through networking at MMC III?",
        type: "textarea",
        required: true,
        rows: 3,
        helper:
          "Examples: raise capital, find distribution, acquire clients, meet investors, explore partnerships, hire talent, enter retail, grow my personal brand, meet other founders, explore real estate opportunities.",
      },
      {
        name: "introRequest",
        label:
          "Is there a specific type of person, company, or opportunity you would especially like an introduction to?",
        type: "textarea",
        rows: 3,
      },
      {
        name: "canOffer",
        label: "What can you potentially offer or help other attendees with?",
        type: "textarea",
        required: true,
        rows: 3,
        helper:
          "Capital, marketing expertise, distribution, introductions, real estate opportunities, media exposure, technology, mentorship, partnerships, etc.",
      },
      {
        name: "topics",
        label: "Which topics are you most interested in learning about at MMC III?",
        type: "multiselect",
        required: true,
        max: 4,
        helper: "Choose up to 4.",
        options: [
          "Business Growth & Scaling",
          "Marketing",
          "Personal Branding",
          "Artificial Intelligence",
          "Raising Capital",
          "E-Commerce",
          "Retail & Mass Distribution",
          "Real Estate",
          "Investing",
          "SaaS",
          "Customer Acquisition",
          "Sales",
          "Operations",
          "Leadership",
          "M&A / Exits",
          "Content & Social Media",
          "Other",
        ],
        section: { title: "What you want to learn" },
      },
      {
        name: "topQuestion",
        label: "What is the #1 business question or challenge you would love addressed at MMC III?",
        type: "textarea",
        required: true,
        rows: 3,
        helper: "This could actually help shape the speakers' content.",
      },
      {
        name: "speakerQuestion",
        label: "If you had 2 minutes with one of our speakers, what would you ask them?",
        type: "textarea",
        rows: 3,
      },
      {
        name: "dietary",
        label: "Do you have any dietary restrictions or food allergies?",
        type: "select",
        required: true,
        options: [
          "None",
          "Vegetarian",
          "Vegan",
          "Gluten-free",
          "Dairy-free",
          "Kosher",
          "Halal",
          "Nut allergy",
          "Shellfish allergy",
          "Other",
        ],
        section: { title: "Dinner & hospitality" },
      },
      {
        name: "dietaryDetails",
        label: "If \u201cOther\u201d: please explain any allergies or dietary requirements we should know about",
        type: "textarea",
        rows: 3,
      },
    ],
  },
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
