"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";
import { planAtLeast } from "@/lib/plan";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function NavLinks({
  sections,
  onNavigate,
  plan,
  collapsed = false,
}: {
  sections: { section: string; items: NavItem[] }[];
  onNavigate?: () => void;
  /** Workspace plan — gated items render a lock below their minPlan. Undefined = still loading, no locks yet. */
  plan?: string;
  /** Icon-only rail; labels move into tooltips. */
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  if (collapsed) {
    return (
      <nav className="flex flex-col items-center gap-3">
        {sections.map(({ section, items }, index) => (
          <div key={section || items[0]?.href} className="flex w-full flex-col items-center gap-1">
            {index > 0 && <span aria-hidden className="mb-2 h-px w-8 bg-white/10" />}
            {items.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname === item.href || pathname.startsWith(item.href + "/");
              const locked = Boolean(
                item.minPlan && plan !== undefined && !planAtLeast(plan, item.minPlan),
              );
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-label={item.label}
                      className={cn(
                        "relative flex size-10 items-center justify-center rounded-lg transition-colors",
                        active
                          ? "bg-primary/15 text-white ring-1 ring-primary/40"
                          : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-white",
                        locked && "opacity-60",
                      )}
                    >
                      <item.icon className="size-[18px]" />
                      {locked && (
                        <Lock className="absolute bottom-1 right-1 size-2.5 text-muted-foreground" />
                      )}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10} className="flex-col items-start gap-0.5">
                    <span className="font-medium">
                      {item.label}
                      {locked ? " · upgrade to unlock" : ""}
                    </span>
                    {item.description && (
                      <span className="text-[11px] opacity-70">{item.description}</span>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </nav>
    );
  }
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
                      "group/nav-item relative flex items-center gap-3 rounded-none px-3 text-sm transition-colors",
                      item.description ? "py-1.5" : "py-2",
                      active
                        ? "font-medium text-white"
                        : "text-sidebar-foreground/80 hover:text-white",
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
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-gradient-to-r from-blue-300 via-blue-400 to-transparent shadow-[0_0_10px_2px_rgba(59,130,246,0.5)] transition-transform duration-300",
                        active ? "scale-x-100" : "group-hover/nav-item:scale-x-100",
                      )}
                    />
                  </Link>
                  {item.children && active && (
                    <div className="mt-0.5 ml-[22px] flex flex-col gap-0.5 border-l border-sidebar-border pl-3.5">
                      {item.children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onNavigate}
                          className="rounded-none px-2 py-1.5 text-[13px] text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
