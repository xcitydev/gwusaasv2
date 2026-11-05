import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function BrandMark({ className, compact }: { className?: string; compact?: boolean }) {
  if (compact) {
    return (
      <Link href="/dashboard" className={cn("flex items-center", className)} aria-label={BRAND.name}>
        <Image src={BRAND.logo.mark} alt={BRAND.name} width={64} height={64} className="size-8" priority />
      </Link>
    );
  }
  return (
    <Link href="/dashboard" className={cn("flex items-center", className)}>
      <Image
        src={BRAND.logo.headerWordmark}
        alt={BRAND.name}
        width={867}
        height={192}
        className="h-6 w-auto"
        priority
      />
    </Link>
  );
}
