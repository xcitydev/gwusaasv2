"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Bot, Images, MessageSquare } from "lucide-react";
import { isConfigured } from "@/lib/runtime";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HubChat } from "./hub-chat";
import { GenerationsRail } from "./generations-rail";

/**
 * The AI Hub tab: chat on the left, recent generations on the right. On
 * phones the two become a Chat / Generations switch, Runway-style.
 */
export function HubTab({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const thread = useQuery(api.hub.getThread, isConfigured ? {} : "skip");
  const [mobileView, setMobileView] = useState<"chat" | "generations">("chat");

  if (!isConfigured) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Bot className="size-8 text-muted-foreground" />
          <p className="font-medium">AI Hub</p>
          <p className="max-w-md text-sm text-muted-foreground">
            The chat comes alive once Clerk, Convex and the Anthropic key are configured.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (thread === undefined) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-[560px] w-full rounded-xl" />
        <Skeleton className="hidden h-[560px] w-full rounded-xl lg:block" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex gap-1 rounded-lg border border-border bg-card p-1 lg:hidden">
        {(
          [
            ["chat", "Chat", MessageSquare],
            ["generations", "Generations", Images],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            onClick={() => setMobileView(value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm transition-colors",
              mobileView === value
                ? "bg-primary/15 font-medium text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className={cn(mobileView !== "chat" && "hidden lg:block")}>
          <HubChat
            initialMessages={thread?.messages ?? []}
            initialJobs={thread?.jobs ?? {}}
            onOpenLibrary={onOpenLibrary}
          />
        </div>
        <div className={cn(mobileView !== "generations" && "hidden lg:block")}>
          <GenerationsRail onOpenLibrary={onOpenLibrary} />
        </div>
      </div>
    </div>
  );
}
