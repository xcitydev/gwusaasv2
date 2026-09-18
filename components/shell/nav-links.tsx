"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";

export function NavLinks({
  sections,
  onNavigate,
}: {
  sections: { section: string; items: NavItem[] }[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-5">
      {sections.map(({ section, items }) => (
        <div key={section}>
          <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">
            {section}
          </p>
          <div className="flex flex-col gap-0.5">
            {items.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname === item.href ||
                    pathname.startsWith(item.href + "/");
              return (
                <div key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {item.badge && (
                      <Badge
                        variant="outline"
                        className="ml-auto border-primary/40 px-1.5 py-0 text-[10px] text-primary"
                      >
                        {item.badge}
                      </Badge>
                    )}
                    {item.children && (
                      <ChevronRight
                        className={cn(
                          "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform",
                          active && "rotate-90",
                        )}
                      />
                    )}
                  </Link>
                  {item.children && active && (
                    <div className="mt-0.5 ml-[22px] flex flex-col gap-0.5 border-l border-sidebar-border pl-3.5">
                      {item.children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onNavigate}
                          className="rounded-md px-2 py-1.5 text-[13px] text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
