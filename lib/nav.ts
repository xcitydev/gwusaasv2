import {
  AudioWaveform,
  MessageCircle,
  LayoutDashboard,
  NotebookPen,
  Send,
  Sparkles,
  ScanSearch,
  AudioLines,
  Users,
  PhoneCall,
  PhoneOutgoing,
  ClipboardList,
  GalleryHorizontalEnd,
  Gift,
  UsersRound,
  Settings,
  LifeBuoy,
  ShieldCheck,
  UserCog,
  Ticket,
  FileCheck,
  ServerCog,
  DollarSign,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Small badge rendered next to the label. */
  badge?: string;
  /** One-line subtext under the label. */
  description?: string;
  /** Only shown to team/agency plan workspaces. */
  agencyOnly?: boolean;
  /** Only shown once the user has forms access (invite code or admin grant). */
  inviteOnly?: boolean;
  /** Sub-links revealed while the item's route is active. */
  children?: { label: string; href: string }[];
};

export const APP_NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    section: "Marketing AI Hub",
    items: [
      {
        label: "Outreach",
        href: "/outreach",
        icon: Send,
        description: "Cold email campaigns and replies",
      },
      {
        label: "Scrape Leads",
        href: "/leads",
        icon: Users,
        description: "Google Maps, LinkedIn and B2B databases",
      },
      {
        label: "AI Receptionist",
        href: "/receptionist",
        icon: PhoneCall,
        description: "Answers calls and books 24/7",
      },
      {
        label: "AI Cold Calling",
        href: "/qualifier",
        icon: PhoneOutgoing,
        description: "Use your Cloned Voice, Set it up to Run Auto",
      },
      {
        label: "Clone Your Voice",
        href: "/voices",
        icon: AudioWaveform,
        description: "15 seconds, then use it everywhere",
      },
      {
        label: "IG DMs & AI Voice",
        href: "/ig-dms",
        icon: MessageCircle,
        badge: "New",
        description: "Manage messages, Automations and Send AI Voice DM's",
      },
    ],
  },
  {
    section: "Meeting tools",
    items: [
      {
        label: "AI Note Taker",
        href: "/note-taker",
        icon: NotebookPen,
        badge: "New",
        description:
          "Automatically records, transcribes, and summarizes conversations across Zoom, Google Meet, Microsoft Teams",
      },
    ],
  },
  {
    section: "Create with AI",
    items: [
      {
        label: "AI Studio",
        href: "/create",
        icon: Sparkles,
        description: "Chat with your AI Hub to make images, video, motion and Studio renders",
      },
      {
        label: "Get Found by AI",
        href: "/get-found",
        icon: ScanSearch,
        description: "Audit how AI sees your business",
      },
      {
        label: "IG Carousels",
        href: "/carousels",
        icon: GalleryHorizontalEnd,
        description: "AI-written, designed slides",
      },
      {
        label: "Audio to Text",
        href: "/audio-to-text",
        icon: AudioLines,
        description: "Transcribe uploads and links",
      },
    ],
  },
  {
    section: "GWU Onboarding Forms",
    items: [
      {
        label: "All services",
        href: "/forms",
        icon: ClipboardList,
        inviteOnly: true,
        description: "Done-for-you service requests",
      },
    ],
  },
  {
    section: "Earn",
    items: [
      {
        label: "Referrals",
        href: "/referrals",
        icon: Gift,
        description: "Earn on every plan you bring in",
      },
    ],
  },
  {
    section: "Account",
    items: [
      {
        label: "Team",
        href: "/team",
        icon: UsersRound,
        agencyOnly: true,
        description: "Members, invites, shared credits",
      },
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        description: "Plan, credits and account",
      },
      {
        label: "Support",
        href: "/support",
        icon: LifeBuoy,
        description: "Tickets and AI help",
      },
    ],
  },
];

/** Drop items the user is not entitled to, and sections that end up empty. */
export function filterNav(
  sections: { section: string; items: NavItem[] }[],
  access: { formsAccess: boolean },
): { section: string; items: NavItem[] }[] {
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter((item) => !item.inviteOnly || access.formsAccess),
    }))
    .filter((s) => s.items.length > 0);
}

export const ADMIN_NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Admin",
    items: [
      { label: "Overview", href: "/admin", icon: ShieldCheck },
      { label: "Users", href: "/admin/users", icon: UserCog },
      { label: "Tickets", href: "/admin/tickets", icon: Ticket },
      { label: "Form Submissions", href: "/admin/forms", icon: FileCheck },
      { label: "Carousel Templates", href: "/admin/templates", icon: GalleryHorizontalEnd },
    ],
  },
  {
    section: "Dev",
    items: [{ label: "Infrastructure", href: "/admin/infra", icon: ServerCog }],
  },
  {
    section: "Super",
    items: [
      { label: "Revenue", href: "/admin/revenue", icon: DollarSign },
      { label: "Admins", href: "/admin/admins", icon: UsersRound },
      { label: "Config", href: "/admin/config", icon: SlidersHorizontal },
    ],
  },
];
