import Link from "next/link";
import { Send, Users, Sparkles, ClipboardList, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { LiveStats } from "@/components/dashboard/live-stats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const quickActions = [
  {
    title: "Start outreach",
    description: "Connect inboxes and launch your first campaign.",
    href: "/outreach",
    icon: Send,
  },
  {
    title: "Find customers",
    description: "Search for leads with plain English.",
    href: "/leads",
    icon: Users,
  },
  {
    title: "Create with AI",
    description: "Generate images and videos for your brand.",
    href: "/create",
    icon: Sparkles,
  },
  {
    title: "Fill a form",
    description: "Request a service from our team.",
    href: "/forms",
    icon: ClipboardList,
  },
];

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Everything happening across your workspace, at a glance."
      />

      <LiveStats />

      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-widest text-muted-foreground">
        Quick actions
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {quickActions.map((action) => (
          <Link key={action.href} href={action.href} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardHeader className="flex flex-row items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <action.icon className="size-4.5" />
                </span>
                <CardTitle className="text-base">{action.title}</CardTitle>
                <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground">
                {action.description}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
