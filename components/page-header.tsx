import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AnimatedHeading } from "@/components/ui/animated-heading";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div>
        <AnimatedHeading as="h1" className="text-3xl font-medium tracking-tight text-white sm:text-4xl">
          {title}
        </AnimatedHeading>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
