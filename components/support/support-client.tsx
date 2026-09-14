"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ListSkeleton } from "@/components/list-skeleton";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { LifeBuoy, Loader2, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TicketThread } from "@/components/support/ticket-thread";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

export function SupportClient() {
  const ticketsQuery = useQuery(api.tickets.mine);
  const tickets = ticketsQuery ?? [];
  const create = useMutation(api.tickets.create);
  const [createOpen, setCreateOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [openTicket, setOpenTicket] = useState<Id<"tickets"> | null>(null);

  const submit = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error("Subject and message are both required.");
      return;
    }
    setCreating(true);
    try {
      const id = await create({ subject, body: message });
      setCreateOpen(false);
      setSubject("");
      setMessage("");
      setOpenTicket(id);
      toast.success("Ticket created — we'll get back to you soon.");
    } catch {
      toast.error("Couldn't create the ticket. Are you signed in?");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Support"
        description="Create a ticket and our team will jump in — you'll see when an admin joins."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New ticket
          </Button>
        }
      />

      {ticketsQuery === undefined ? (
        <ListSkeleton rows={3} />
      ) : tickets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <LifeBuoy className="size-8 text-muted-foreground" />
            <p className="font-medium">No tickets yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Need help with anything? Open a ticket and the team will reply here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {tickets.map((t) => (
              <button
                key={t._id}
                onClick={() => setOpenTicket(t._id)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(t.lastMessageAt).toLocaleString()}
                  </p>
                </div>
                <StatusBadge status={t.status} />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New support ticket</DialogTitle>
            <DialogDescription>
              Describe what you need — the more detail, the faster we can help.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <Textarea
              placeholder="What's going on?"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={creating}>
              {creating && <Loader2 className="size-4 animate-spin" />} Create ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={openTicket !== null} onOpenChange={(o) => !o && setOpenTicket(null)}>
        <SheetContent side="right" className="flex w-full flex-col p-5 sm:max-w-lg">
          <SheetTitle className="sr-only">Ticket conversation</SheetTitle>
          {openTicket && (
            <TicketThread ticketId={openTicket} onClosed={() => setOpenTicket(null)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
