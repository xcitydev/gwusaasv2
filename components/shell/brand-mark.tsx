import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={cn("flex items-center gap-2.5", className)}
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary font-display text-lg italic text-primary-foreground">
        {BRAND.name.charAt(0)}
      </span>
      <span className="font-display text-xl italic tracking-wide text-foreground">
        {BRAND.name}
      </span>
    </Link>
  );
}
