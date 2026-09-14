"use client";

import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { hasConvex } from "@/lib/runtime";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function BellButton({ count }: { count: number }) {
  return (
    <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
      <Bell className="size-4.5" />
      {count > 0 && (
        <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Bell className="size-6 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">No notifications yet</p>
    </div>
  );
}

function LiveNotifications() {
  const router = useRouter();
  const notifications = useQuery(api.notifications.list) ?? [];
  const unread = useQuery(api.notifications.unreadCount) ?? 0;
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <BellButton count={unread} />
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={() => markAllRead()}
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </Button>
          )}
        </div>
        {notifications.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="max-h-96 overflow-y-auto overscroll-contain">
            <div className="flex flex-col">
              {notifications.map((n) => (
                <button
                  key={n._id}
                  className={cn(
                    "flex flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent",
                    !n.read && "bg-primary/5",
                  )}
                  onClick={() => {
                    if (!n.read) markRead({ id: n._id });
                    if (n.href) router.push(n.href);
                  }}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {!n.read && <span className="size-1.5 rounded-full bg-primary" />}
                    {n.title}
                  </span>
                  {n.body && (
                    <span className="text-xs text-muted-foreground">{n.body}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function NotificationsBell() {
  if (!hasConvex) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <span>
            <BellButton count={0} />
          </span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <EmptyState />
        </PopoverContent>
      </Popover>
    );
  }
  return <LiveNotifications />;
}
