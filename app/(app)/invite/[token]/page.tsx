"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Loader2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LivePage } from "@/components/live-page";

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const acceptInvite = useMutation(api.team.acceptInvite);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      const workspaceName = await acceptInvite({ token });
      toast.success(`Welcome to ${workspaceName}!`);
      router.push("/dashboard");
    } catch (e) {
      toast.error(
        e instanceof Error && e.message.includes("no longer valid")
          ? "This invite is no longer valid — ask for a new one."
          : "Couldn't accept the invite. Make sure you're signed in.",
      );
      setBusy(false);
    }
  };

  return (
    <LivePage>
      <div className="mx-auto max-w-md pt-10">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <UsersRound className="size-7" />
            </span>
            <div>
              <p className="font-display text-xl italic">You&apos;ve been invited</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Accept to join the team workspace — you&apos;ll share leads,
                campaigns and credits.
              </p>
            </div>
            <Button onClick={accept} disabled={busy} className="min-w-40">
              {busy && <Loader2 className="size-4 animate-spin" />} Accept invite
            </Button>
          </CardContent>
        </Card>
      </div>
    </LivePage>
  );
}
