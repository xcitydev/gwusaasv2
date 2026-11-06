import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** 404 for unmatched URLs and any notFound() without a closer boundary. */
export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Compass className="size-6" />
          </span>
          <div>
            <p className="font-medium">Page not found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This page doesn&apos;t exist, or you don&apos;t have access to it.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">Home</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
