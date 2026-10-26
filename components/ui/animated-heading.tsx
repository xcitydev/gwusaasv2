"use client";

import type { ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { TextAnimate } from "@/components/ui/text-animate";

export function AnimatedHeading({
  children,
  as = "h2",
  className,
  segmentClassName,
}: {
  children: ReactNode;
  as?: "h1" | "h2";
  className: string;
  segmentClassName?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    const Heading = as;
    return (
      <Heading className={className}>
        {segmentClassName ? <span className={segmentClassName}>{children}</span> : children}
      </Heading>
    );
  }

  if (typeof children !== "string") {
    const Heading = as;
    return (
      <Heading className={className}>
        {segmentClassName ? <span className={segmentClassName}>{children}</span> : children}
      </Heading>
    );
  }

  return (
    <TextAnimate
      as={as}
      animation="blurInUp"
      by="character"
      once
      duration={0.5}
      className={className}
      segmentClassName={segmentClassName}
    >
      {children}
    </TextAnimate>
  );
}
