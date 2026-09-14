import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  // Forms
  processing: "border-primary/40 bg-primary/10 text-primary",
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  closed: "border-border bg-secondary text-muted-foreground",
  // Tickets
  open: "border-primary/40 bg-primary/10 text-primary",
  answered: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  // Generic lifecycle
  draft: "border-border bg-secondary text-muted-foreground",
  pending: "border-primary/40 bg-primary/10 text-primary",
  running: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  in_progress: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  live: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  qualified: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  warmed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  warming: "border-primary/40 bg-primary/10 text-primary",
  connecting: "border-border bg-secondary text-muted-foreground",
  paused: "border-border bg-secondary text-muted-foreground",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  locked: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("capitalize", STYLES[status] ?? "border-border", className)}
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
