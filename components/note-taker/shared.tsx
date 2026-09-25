"use client";

import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  MEETING_PLATFORMS,
  MEETING_STATUSES,
  type MeetingPlatform,
  type MeetingStatus,
} from "@/lib/note-taker";
import { cn } from "@/lib/utils";

export type Overview = NonNullable<
  FunctionReturnType<typeof api.noteTaker.overview>
>;
export type MeetingRow = FunctionReturnType<
  typeof api.noteTaker.liveMeetings
>[number];

export function serverMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : "";
  return raw.split("Uncaught Error: ").pop() || fallback;
}

/** Friendly copy for the errors every note-taker action can throw. */
export function friendlyError(e: unknown, fallback: string): string {
  const msg = serverMessage(e, fallback);
  if (msg.includes("INSUFFICIENT_CREDITS")) {
    return "Not enough credits to record a meeting — top up first.";
  }
  if (msg.includes("NOT_CONFIGURED")) {
    return msg.replace("NOT_CONFIGURED: ", "");
  }
  return msg;
}

export function StatusBadge({ status }: { status: MeetingStatus }) {
  const meta = MEETING_STATUSES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
        meta.className,
      )}
    >
      {status === "recording" && (
        <span className="size-1.5 animate-pulse rounded-full bg-red-400" />
      )}
      {meta.label}
    </span>
  );
}

export function platformLabel(platform: string | null | undefined): string {
  return platform && platform in MEETING_PLATFORMS
    ? MEETING_PLATFORMS[platform as MeetingPlatform]
    : "Meeting";
}

export function whenLabel(ms: number): string {
  const date = new Date(ms);
  const today = new Date();
  const sameDay = today.toDateString() === date.toDateString();
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return `Today, ${time}`;
  return `${date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })}, ${time}`;
}
