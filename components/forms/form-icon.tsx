import {
  Palette,
  Newspaper,
  Globe,
  Building2,
  AtSign,
  Megaphone,
  ClipboardList,
  ScanSearch,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Palette,
  Newspaper,
  Globe,
  Building2,
  // Brand icons were removed from lucide; AtSign stands in for Instagram.
  Instagram: AtSign,
  Megaphone,
  ScanSearch,
  MessagesSquare,
};

export function formIcon(name: string): LucideIcon {
  return ICONS[name] ?? ClipboardList;
}
