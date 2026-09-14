"use client";

import { UserButton as ClerkUserButton } from "@clerk/nextjs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { isConfigured } from "@/lib/runtime";

export function ShellUserButton() {
  if (!isConfigured) {
    return (
      <Avatar className="size-8">
        <AvatarFallback className="bg-secondary text-xs">?</AvatarFallback>
      </Avatar>
    );
  }
  return (
    <ClerkUserButton appearance={{ elements: { avatarBox: "size-8" } }} />
  );
}
