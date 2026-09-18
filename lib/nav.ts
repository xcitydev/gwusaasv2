import {
  AudioWaveform,
  MessageCircle,
  LayoutDashboard,
  Send,
  Sparkles,
  Wrench,
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
  /** Only shown to team/agency plan workspaces. */
  agencyOnly?: boolean;
  /** Sub-links revealed while the item's route is active. */
  children?: { label: string; href: string }[];
};

export const APP_NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    section: "Grow",
    items: [
      { label: "Outreach", href: "/outreach", icon: Send },
      { label: "Find Customers", href: "/leads", icon: Users },
      { label: "AI Receptionist", href: "/receptionist", icon: PhoneCall },
      { label: "Lead Qualifier", href: "/qualifier", icon: PhoneOutgoing },
      { label: "Voice Clones", href: "/voices", icon: AudioWaveform },
      { label: "IG DMs", href: "/ig-dms", icon: MessageCircle, badge: "New" },
    ],
  },
  {
    section: "Create",
    items: [
      { label: "Create with AI", href: "/create", icon: Sparkles },
      {
        label: "AI Tools",
        href: "/tools",
        icon: Wrench,
        children: [
          { label: "Get Found by AI", href: "/tools?tab=audit" },
          { label: "IG Carousels", href: "/tools?tab=carousel" },
          { label: "Audio to Text", href: "/tools?tab=transcribe" },
        ],
      },
    ],
  },
  {
    section: "GWU Onboarding Forms",
    items: [{ label: "All services", href: "/forms", icon: ClipboardList }],
  },
  {
    section: "Earn",
    items: [{ label: "Referrals", href: "/referrals", icon: Gift }],
  },
  {
    section: "Account",
    items: [
      { label: "Team", href: "/team", icon: UsersRound, agencyOnly: true },
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Support", href: "/support", icon: LifeBuoy },
    ],
  },
];

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
