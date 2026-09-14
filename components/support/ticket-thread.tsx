"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

/** Shared ticket conversation view, used by both /support and /admin/tickets. */
export function TicketThread({
  ticketId,
  onClosed,
}: {
  ticketId: Id<"tickets">;
  onClosed?: () => void;
}) {
  const ticket = useQuery(api.tickets.get, { id: ticketId });
  const reply = useMutation(api.tickets.reply);
  const close = useMutation(api.tickets.close);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  if (ticket === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (ticket === null) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Ticket not found.</p>;
  }

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await reply({ id: ticketId, body });
      setBody("");
    } catch {
      toast.error("Couldn't send your reply. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{ticket.subject}</p>
          <p className="text-xs text-muted-foreground">
            {ticket.userName ?? ticket.userEmail}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={ticket.status} />
          {ticket.status !== "closed" && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await close({ id: ticketId });
                onClosed?.();
              }}
            >
              Close
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 py-4">
        <div className="flex flex-col gap-3 pr-3">
          {ticket.messages.map((m) =>
            m.kind === "event" ? (
              <p
                key={m._id}
                className="text-center text-xs italic text-muted-foreground"
              >
                — {m.body} —
              </p>
            ) : (
              <div
                key={m._id}
                className={cn(
                  "max-w-[85%] rounded-xl px-4 py-2.5 text-sm",
                  m.isMe
                    ? "self-end bg-primary/15 text-foreground"
                    : m.isAdmin
                      ? "self-start border border-primary/30 bg-card"
                      : "self-start bg-secondary",
                )}
              >
                <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">
                  {m.isMe ? "You" : m.authorName}
                  {m.isAdmin && !m.isMe && (
                    <span className="ml-1 text-primary">· Support</span>
                  )}
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            ),
          )}
        </div>
      </ScrollArea>

      {ticket.status !== "closed" && (
        <div className="flex items-end gap-2 border-t pt-3">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a reply…"
            rows={2}
            className="min-h-0 resize-none"
          />
          <Button onClick={send} disabled={sending || !body.trim()} size="icon">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}
