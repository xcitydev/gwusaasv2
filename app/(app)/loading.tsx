import { Skeleton } from "@/components/ui/skeleton";

/** Shown inside the app shell while a signed-in page streams in. */
export default function AppLoading() {
  return (
    <div className="space-y-4 py-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
