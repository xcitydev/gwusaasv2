"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ListSkeleton } from "@/components/list-skeleton";
import { toast } from "sonner";
import { Megaphone, MoreHorizontal, Pause, Play, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CampaignWizard } from "@/components/outreach/campaign-wizard";
import { Doc, Id } from "@/convex/_generated/dataModel";

type CampaignRow = Doc<"campaigns"> & { leadCount: number };

export function CampaignsTab() {
  const router = useRouter();
  const campaignsQuery = useQuery(api.outreach.listCampaigns);
  const campaigns = (campaignsQuery ?? []) as CampaignRow[];
  const setStatus = useAction(api.outreachActions.setCampaignStatus);
  const removeCampaign = useMutation(api.outreach.removeCampaign);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<CampaignRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CampaignRow | null>(null);

  const activate = async () => {
    if (!publishTarget) return;
    try {
      await setStatus({ id: publishTarget._id, status: "active" });
      toast.success(`${publishTarget.name} is live.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't activate.");
    }
    setPublishTarget(null);
  };

  const togglePause = async (campaign: CampaignRow) => {
    const nextStatus = campaign.status === "active" ? "paused" : "active";
    await setStatus({ id: campaign._id, status: nextStatus });
    toast.success(nextStatus === "paused" ? "Campaign paused." : "Campaign resumed.");
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {campaigns.filter((c) => c.status === "active").length} active ·{" "}
          {campaigns.length} total
        </p>
        <Button onClick={() => setWizardOpen(true)}>
          <Plus className="size-4" /> New campaign
        </Button>
      </div>

      {campaignsQuery === undefined ? (
        <ListSkeleton rows={3} />
      ) : campaigns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Megaphone className="size-8 text-muted-foreground" />
            <p className="font-medium">No campaigns yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Import leads, write your sequence with variations, set the schedule,
              pick warmed inboxes, review and publish.
            </p>
            <Button className="mt-1" onClick={() => setWizardOpen(true)}>
              <Plus className="size-4" /> Create your first campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Leads</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Replies</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow
                    key={campaign._id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/outreach/campaigns/${campaign._id}`)}
                  >
                    <TableCell className="font-medium text-primary">
                      {campaign.name}
                    </TableCell>
                    <TableCell><StatusBadge status={campaign.status} /></TableCell>
                    <TableCell>{campaign.leadCount}</TableCell>
                    <TableCell>{campaign.stats?.sent ?? 0}</TableCell>
                    <TableCell>{campaign.stats?.replied ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {campaign.sendWindowStart}–{campaign.sendWindowEnd}
                      <br />
                      {campaign.dailyCap}/day
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Campaign actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {campaign.status === "draft" && (
                            <DropdownMenuItem onClick={() => setPublishTarget(campaign)}>
                              <Play className="size-4" /> Publish
                            </DropdownMenuItem>
                          )}
                          {(campaign.status === "active" || campaign.status === "paused") && (
                            <DropdownMenuItem onClick={() => togglePause(campaign)}>
                              {campaign.status === "active" ? (
                                <>
                                  <Pause className="size-4" /> Pause
                                </>
                              ) : (
                                <>
                                  <Play className="size-4" /> Resume
                                </>
                              )}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteTarget(campaign)}
                          >
                            <Trash2 className="size-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CampaignWizard open={wizardOpen} onOpenChange={setWizardOpen} />

      <AlertDialog open={publishTarget !== null} onOpenChange={(o) => !o && setPublishTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish {publishTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sending starts inside the campaign&apos;s window (
              {publishTarget?.sendWindowStart}–{publishTarget?.sendWindowEnd},{" "}
              {publishTarget?.dailyCap} emails/day). You can pause anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={activate}>Publish campaign</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The sequence and lead assignments are removed. Your leads stay in
              Find Leads. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  await removeCampaign({ id: deleteTarget._id as Id<"campaigns"> });
                  toast.success("Campaign deleted.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Delete failed.");
                }
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
