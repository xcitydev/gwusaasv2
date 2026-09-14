"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ListSkeleton } from "@/components/list-skeleton";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, MailOpen, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "interested", label: "Interested" },
  { value: "not_interested", label: "Not interested" },
  { value: "out_of_office", label: "Out of office" },
  { value: "unsubscribed", label: "Unsubscribed" },
  { value: "other", label: "Other" },
] as const;

type Category = Doc<"replies">["category"];

const CATEGORY_STYLES: Record<Category, string> = {
  interested: "bg-emerald-500/15 text-emerald-400",
  not_interested: "bg-secondary text-muted-foreground",
  out_of_office: "bg-sky-500/15 text-sky-400",
  unsubscribed: "bg-destructive/15 text-destructive",
  other: "bg-secondary text-muted-foreground",
};

function ReplyDetail({ reply }: { reply: Doc<"replies"> }) {
  const sendReply = useAction(api.outreachActions.sendReply);
  const suggestReply = useAction(api.ai.suggestReply);
  // Live thread — a sent reply shows up here the moment it's recorded.
  const thread = useQuery(api.outreach.getReplyThread, { id: reply._id });
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const suggest = async () => {
    setSuggesting(true);
    try {
      setBody(await suggestReply({ replyId: reply._id }));
    } catch {
      toast.error("Couldn't generate a suggestion.");
    } finally {
      setSuggesting(false);
    }
  };

  const send = async () => {
    setSending(true);
    try {
      const { relayed } = await sendReply({ id: reply._id, body });
      setBody("");
      toast.success(
        relayed
          ? "Reply sent through your inbox."
          : "Reply recorded — it sends once the email engine link is complete.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  const sentReplies = thread?.sentReplies ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b pb-3">
        <p className="font-medium">{reply.fromName ?? reply.leadEmail}</p>
        <p className="text-xs text-muted-foreground">{reply.leadEmail}</p>
        <p className="mt-2 text-sm font-medium">{reply.subject}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
        <div className="max-w-[90%] rounded-xl bg-secondary px-4 py-3">
          <p className="whitespace-pre-wrap text-sm">{reply.body}</p>
        </div>
        {sentReplies.map((sent) => (
          <div key={sent._id} className="flex justify-end">
            <div className="max-w-[90%] rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
              <p className="whitespace-pre-wrap text-sm">{sent.body}</p>
              <p className="mt-1.5 text-right text-[11px] text-muted-foreground">
                You{sent.eaccount ? ` · via ${sent.eaccount}` : ""} ·{" "}
                {new Date(sent.sentAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t pt-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your reply…"
          rows={4}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={suggest} disabled={suggesting}>
            {suggesting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4 text-primary" />
            )}
            AI suggest
          </Button>
          <Button size="sm" onClick={send} disabled={sending || !body.trim()}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send reply
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MasterInboxTab() {
  const [category, setCategory] = useState<string>("all");
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const campaigns = useQuery(api.outreach.listCampaigns) ?? [];
  const repliesQuery = useQuery(api.outreach.listReplies, {
    ...(category !== "all" && { category: category as Category }),
    ...(campaignFilter !== "all" && { campaignId: campaignFilter as Id<"campaigns"> }),
  });
  const replies = repliesQuery ?? [];
  const markRead = useMutation(api.outreach.markReplyRead);
  const [openReply, setOpenReply] = useState<Doc<"replies"> | null>(null);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              category === c.value
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
        <div className="ml-auto">
          <Select value={campaignFilter} onValueChange={setCampaignFilter}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="All campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaigns.map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {repliesQuery === undefined ? (
        <ListSkeleton rows={5} />
      ) : replies.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <MailOpen className="size-8 text-muted-foreground" />
            <p className="font-medium">No replies yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Every reply across all campaigns lands here, auto-categorized —
              interested, out of office, unsubscribed and more.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {replies.map((reply) => (
              <button
                key={reply._id}
                onClick={() => {
                  setOpenReply(reply);
                  if (!reply.read) markRead({ id: reply._id });
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent",
                  !reply.read && "bg-primary/5",
                )}
              >
                {!reply.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {reply.fromName ?? reply.leadEmail}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {reply.subject}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{reply.body}</p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    CATEGORY_STYLES[reply.category],
                  )}
                >
                  {reply.category.replace(/_/g, " ")}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Sheet open={openReply !== null} onOpenChange={(o) => !o && setOpenReply(null)}>
        <SheetContent side="right" className="flex w-full flex-col p-5 sm:max-w-lg">
          <SheetTitle className="sr-only">Reply detail</SheetTitle>
          {openReply && <ReplyDetail reply={openReply} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
