"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  Users,
  Ticket,
  FileCheck,
  ShieldCheck,
  Crown,
  ArrowRight,
} from "lucide-react";
import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { hasConvex } from "@/lib/runtime";

function BootstrapCard() {
  const hasAnyAdmin = useQuery(api.admin.hasAnyAdmin);
  const bootstrap = useMutation(api.admin.bootstrapSuper);
  if (hasAnyAdmin !== false) return null;
  return (
    <Card className="mb-6 border-primary/40 bg-primary/5">
      <CardContent className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <Crown className="size-4 text-primary" /> No admin exists yet
        </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Claim the superadmin role for your account to unlock the admin panel.
          </p>
        </div>
        <Button
          onClick={async () => {
            try {
              await bootstrap();
              toast.success("You are now the superadmin.");
            } catch {
              toast.error("Couldn't claim superadmin. Are you signed in?");
            }
          }}
        >
          Claim superadmin
        </Button>
      </CardContent>
    </Card>
  );
}

function Overview() {
  const stats = useQuery(api.admin.overview);
  const cards = [
    { label: "Total users", value: stats?.totalUsers, icon: Users, href: "/admin/users" },
    { label: "Open tickets", value: stats?.openTickets, icon: Ticket, href: "/admin/tickets" },
    { label: "Forms processing", value: stats?.processingForms, icon: FileCheck, href: "/admin/forms" },
    { label: "Paid workspaces", value: stats?.paidWorkspaces, icon: ShieldCheck, href: "/admin/revenue" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <Link key={c.label} href={c.href} className="group">
          <Card className="transition-colors group-hover:border-primary/40">
            <CardContent className="flex items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <c.icon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-xl font-semibold">{c.value ?? "—"}</p>
              </div>
              <ArrowRight className="ml-auto size-4 text-muted-foreground group-hover:text-primary" />
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function AdminOverviewPage() {
  return (
    <LivePage>
      <PageHeader
        title="Admin Overview"
        description="Platform health and activity at a glance."
      />
      {hasConvex && (
        <>
          <BootstrapCard />
          <Overview />
        </>
      )}
    </LivePage>
  );
}
