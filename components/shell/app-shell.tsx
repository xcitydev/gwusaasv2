"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { Menu, ShieldCheck } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { hasClerk, hasConvex } from "@/lib/runtime";
import { APP_NAV, ADMIN_NAV, filterNav } from "@/lib/nav";
import { BrandMark } from "@/components/shell/brand-mark";
import { NavLinks } from "@/components/shell/nav-links";
import { CreditsPill } from "@/components/shell/credits-pill";
import { NotificationsBell } from "@/components/shell/notifications-bell";
import { ShellUserButton } from "@/components/shell/user-button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

function AdminPanelLink() {
  const me = useQuery(api.users.me);
  if (!me?.adminRole) return null;
  return <AdminLinkInner />;
}

function AdminLinkInner() {
  return (
    <Link
      href="/admin"
      className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
    >
      <ShieldCheck className="size-3.5" /> Admin panel
    </Link>
  );
}

/** The app nav, minus invite-only sections until the user has access. */
function AppNav({ onNavigate }: { onNavigate?: () => void }) {
  const me = useQuery(api.users.me);
  return (
    <NavLinks
      sections={filterNav(APP_NAV, { formsAccess: Boolean(me?.formsAccess) })}
      onNavigate={onNavigate}
    />
  );
}

function SidebarContent({
  variant,
  onNavigate,
}: {
  variant: "app" | "admin";
  onNavigate?: () => void;
}) {
  const sections = variant === "admin" ? ADMIN_NAV : APP_NAV;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <BrandMark />
        {variant === "admin" && (
          <span className="ml-2 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Admin
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {variant === "app" && hasConvex && hasClerk ? (
          <AppNav onNavigate={onNavigate} />
        ) : (
          <NavLinks sections={sections} onNavigate={onNavigate} />
        )}
      </div>
      <div className="pb-4 pt-2">
        {variant === "app" ? (
          hasConvex && hasClerk ? (
            <AdminPanelLink />
          ) : (
            <AdminLinkInner />
          )
        ) : (
          <Link
            href="/dashboard"
            className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            ← Back to app
          </Link>
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

  return (
    <div className="flex min-h-dvh w-full">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarContent variant={variant} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
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
            <SheetContent side="left" className="w-72 bg-sidebar p-0">
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

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <CreditsPill />
            <NotificationsBell />
            <ShellUserButton />
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
