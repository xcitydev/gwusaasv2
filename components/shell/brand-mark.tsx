import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <Link href="/dashboard" className={cn("flex items-center", className)}>
      <Image
        src={BRAND.logo.wordmark}
        alt={BRAND.name}
        width={867}
        height={192}
        className="h-6 w-auto"
        priority
      />
    </Link>
  );
}
