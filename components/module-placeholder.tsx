import { type LucideIcon, Hammer } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Temporary stand-in for modules that ship in a later build phase. Every stub
 * page uses this so the shell, nav and routing are real from day one.
 */
export function ModulePlaceholder({
  icon: Icon,
  title,
  description,
  phase,
  features,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: string;
  features: string[];
}) {
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Badge
            variant="outline"
            className="border-primary/40 text-primary"
          >
            <Hammer className="size-3" /> {phase}
          </Badge>
        }
      />
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="size-7" />
          </span>
          <div className="max-w-md">
            <p className="font-medium">This module is on the build schedule.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              What&apos;s coming here:
            </p>
          </div>
          <ul className="grid max-w-lg gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {features.map((f) => (
              <li
                key={f}
                className="rounded-lg border border-border bg-card px-3 py-2 text-left"
              >
                {f}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
