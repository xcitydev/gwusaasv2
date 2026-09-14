import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Placeholder rows shown while a list query is still loading — so pages
 * never flash an empty state before the data pops in.
 */
export function ListSkeleton({
  rows = 4,
  inCard = true,
  className,
}: {
  rows?: number;
  inCard?: boolean;
  className?: string;
}) {
  const body = (
    <div className={cn("divide-y divide-border", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-3 px-5 py-4"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3 max-w-52" />
            <Skeleton className="h-3 w-1/5 max-w-32" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
  if (!inCard) return body;
  return (
    <Card>
      <CardContent className="p-0">{body}</CardContent>
    </Card>
  );
}

/** Placeholder for tile galleries (library grids, template pickers). */
export function GridSkeleton({
  tiles = 10,
  className,
}: {
  tiles?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
        className,
      )}
    >
      {Array.from({ length: tiles }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-xl" />
      ))}
    </div>
  );
}
