"use client";

import { ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { hasClerk, hasConvex } from "@/lib/runtime";
import { APP_NAV, ADMIN_NAV, adminNavFor, filterNav } from "@/lib/nav";
import { BrandMark } from "@/components/shell/brand-mark";
import { NavLinks } from "@/components/shell/nav-links";
import { CreditsPill } from "@/components/shell/credits-pill";
import { TopUpDialogHost } from "@/components/billing/top-up-dialog";
import { NotificationsBell } from "@/components/shell/notifications-bell";
import { ShellUserButton } from "@/components/shell/user-button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "sidebar-collapsed";

// Collapsed-sidebar preference: localStorage when available, memory otherwise.
// Read through useSyncExternalStore so SSR renders expanded without a mismatch.
let memoryCollapsed = false;
const collapseListeners = new Set<() => void>();
function readCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(COLLAPSE_KEY);
    return stored === null ? memoryCollapsed : stored === "1";
  } catch {
    return memoryCollapsed;
  }
}
function writeCollapsed(next: boolean) {
  memoryCollapsed = next;
  try {
    localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  } catch {
    // Storage blocked: remembered for this page only.
  }
  collapseListeners.forEach((listener) => listener());
}
function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    collapseListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** A footer link that turns into an icon button with a tooltip on the rail. */
function RailLink({
  href,
  label,
  icon,
  collapsed,
  className,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  collapsed?: boolean;
  className: string;
}) {
  if (!collapsed) {
    return (
      <Link href={href} className={cn("mx-3 mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs", className)}>
        {icon} {label}
      </Link>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          className={cn("mx-auto mb-2 flex size-10 items-center justify-center rounded-lg", className)}
        >
          {icon}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function AdminPanelLink({ collapsed }: { collapsed?: boolean }) {
  const me = useQuery(api.users.me);
  if (!me?.adminRole) return null;
  return <AdminLinkInner collapsed={collapsed} />;
}

function AdminLinkInner({ collapsed }: { collapsed?: boolean }) {
  return (
    <RailLink
      href="/admin"
      label="Admin panel"
      collapsed={collapsed}
      icon={<ShieldCheck className={collapsed ? "size-4" : "size-3.5"} />}
      className="border border-primary/25 bg-primary/5 font-medium text-primary transition-colors hover:bg-primary/15"
    />
  );
}

function SaasAmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 flex justify-between border-x border-white/5 px-4 sm:px-6">
        {[5, 7, 5, 8].map((duration, index) => (
          <div
            key={index}
            className={`relative h-full w-px overflow-hidden bg-white/5 ${
              index === 1 ? "hidden md:block" : ""
            } ${index === 2 ? "hidden lg:block" : ""}`}
          >
            <div
              className="absolute inset-x-0 top-0 h-[200px] animate-border-beam bg-gradient-to-b from-transparent via-blue-500/40 to-transparent motion-reduce:hidden"
              style={{
                animationDuration: `${duration}s`,
                animationDelay: `${index === 0 ? 0 : index === 1 ? 2 : index === 2 ? 4 : 1}s`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The app nav, minus invite-only sections until the user has access. */
function AppNav({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
  const me = useQuery(api.users.me);
  return (
    <NavLinks
      collapsed={collapsed}
      sections={filterNav(APP_NAV, { formsAccess: Boolean(me?.formsAccess) })}
      onNavigate={onNavigate}
      // Admins see everything unlocked; others lock below each item's minPlan.
      plan={me === undefined ? undefined : me?.adminRole ? "team" : (me?.workspace?.plan ?? "free")}
    />
  );
}

/** Admin nav trimmed to the admin's role, so nobody sees pages they can't use. */
function AdminNav({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
  const me = useQuery(api.users.me);
  return (
    <NavLinks sections={adminNavFor(me?.adminRole)} onNavigate={onNavigate} collapsed={collapsed} />
  );
}

function SidebarContent({
  variant,
  onNavigate,
  collapsed = false,
}: {
  variant: "app" | "admin";
  onNavigate?: () => void;
  /** Icon-only rail (desktop). */
  collapsed?: boolean;
}) {
  const sections = variant === "admin" ? ADMIN_NAV : APP_NAV;
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center" : "px-5")}>
        <BrandMark compact={collapsed} />
        {variant === "admin" && !collapsed && (
          <span className="ml-2 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Admin
          </span>
        )}
      </div>
      <div className={cn("flex-1 overflow-y-auto py-2", collapsed ? "no-scrollbar px-0" : "px-2")}>
        {variant === "app" && hasConvex && hasClerk ? (
          <AppNav onNavigate={onNavigate} collapsed={collapsed} />
        ) : variant === "admin" && hasConvex && hasClerk ? (
          <AdminNav onNavigate={onNavigate} collapsed={collapsed} />
        ) : (
          <NavLinks sections={sections} onNavigate={onNavigate} collapsed={collapsed} />
        )}
      </div>
      <div className="pb-4 pt-2">
        {variant === "app" ? (
          hasConvex && hasClerk ? (
            <AdminPanelLink collapsed={collapsed} />
          ) : (
            <AdminLinkInner collapsed={collapsed} />
          )
        ) : (
          <RailLink
            href="/dashboard"
            label="Back to app"
            collapsed={collapsed}
            icon={<ArrowLeft className={collapsed ? "size-4" : "size-3.5"} />}
            className="border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          />
        )}
      </div>
    </div>
  );
}

export function AppShell({
  children,
  variant = "app",
}: {
  children: ReactNode;
  variant?: "app" | "admin";
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop sidebar: full, or icons only (remembered per browser).
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const toggleCollapsed = useCallback(() => writeCollapsed(!readCollapsed()), []);
  // Ctrl/⌘ + B toggles it, like most editors — but not while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "b") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  return (
    <div data-saas-shell className="relative isolate min-h-dvh w-full bg-black">
      <SaasAmbientBackground />
      <div className="relative z-10 flex min-h-dvh w-full">
        {/* Desktop sidebar */}
        <aside
          data-collapsed={collapsed || undefined}
          className={cn(
            "fixed inset-y-4 left-4 z-30 hidden overflow-hidden rounded-[1rem] border border-white/15 bg-black shadow-[0_30px_80px_-24px_rgba(0,0,0,0.96),0_0_30px_-14px_rgba(59,130,246,0.16)] ring-1 ring-white/5 transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block",
            collapsed ? "w-[4.5rem]" : "w-72",
          )}
        >
          <SidebarContent variant={variant} collapsed={collapsed} />
        </aside>

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ease-out motion-reduce:transition-none",
            collapsed ? "lg:pl-28" : "lg:pl-80",
          )}
        >
          {/* Topbar */}
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/10 bg-black/95 px-4 backdrop-blur sm:px-6">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 bg-black p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <SidebarContent
                  variant={variant}
                  onNavigate={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>

            <div className="lg:hidden">
              <BrandMark />
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden text-muted-foreground hover:text-foreground lg:inline-flex"
                  onClick={toggleCollapsed}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  aria-pressed={collapsed}
                >
                  {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {collapsed ? "Expand sidebar" : "Collapse sidebar"} · Ctrl/⌘ B
              </TooltipContent>
            </Tooltip>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <CreditsPill />
              <NotificationsBell />
              <ShellUserButton />
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
          {/* One top-up dialog for every page: Settings opens it, and any
            action that runs short of credits opens it with the exact gap. */}
          {hasConvex && <TopUpDialogHost />}
        </div>
      </div>
    </div>
  );
}
