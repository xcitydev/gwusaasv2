"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";
import { planAtLeast } from "@/lib/plan";

export function NavLinks({
  sections,
  onNavigate,
  plan,
}: {
  sections: { section: string; items: NavItem[] }[];
  onNavigate?: () => void;
  /** Workspace plan — gated items render a lock below their minPlan. Undefined = still loading, no locks yet. */
  plan?: string;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-5">
      {sections.map(({ section, items }) => (
        <div key={section || items[0]?.href}>
          {section && (
            <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">
              {section}
            </p>
          )}
          <div className="flex flex-col gap-0.5">
            {items.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname === item.href ||
                    pathname.startsWith(item.href + "/");
              const locked = Boolean(
                item.minPlan && plan !== undefined && !planAtLeast(plan, item.minPlan),
              );
              return (
                <div key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                      item.description ? "py-1.5" : "py-2",
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      locked && "opacity-60",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate">{item.label}</span>
                      {item.description && (
                        <span
                          className={cn(
                            "whitespace-normal text-[11px] font-normal leading-snug",
                            active ? "text-primary/70" : "text-muted-foreground/70",
                          )}
                        >
                          {item.description}
                        </span>
                      )}
                    </span>
                    {locked && (
                      <Lock
                        className="ml-auto size-3.5 shrink-0 text-muted-foreground/80"
                        aria-label="Upgrade to unlock"
                      />
                    )}
                    {!locked && item.badge && (
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
