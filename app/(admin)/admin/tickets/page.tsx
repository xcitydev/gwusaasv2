"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { LivePage } from "@/components/live-page";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TicketThread } from "@/components/support/ticket-thread";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Filter = "open" | "answered" | "closed" | "all";

function TicketQueue() {
  const [filter, setFilter] = useState<Filter>("open");
  const tickets =
    useQuery(api.tickets.adminList, filter === "all" ? {} : { status: filter }) ?? [];
  const [openTicket, setOpenTicket] = useState<Id<"tickets"> | null>(null);

  return (
    <>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList className="mb-4">
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="answered">Answered</TabsTrigger>
          <TabsTrigger value="closed">Closed</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          {tickets.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No tickets in this queue.
            </p>
          )}
          {tickets.map((t) => (
            <button
              key={t._id}
              onClick={() => setOpenTicket(t._id)}
              className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {t.userName ?? t.userEmail} · {new Date(t.lastMessageAt).toLocaleString()}
                </p>
              </div>
              <StatusBadge status={t.status} />
            </button>
          ))}
        </CardContent>
      </Card>

      <Sheet open={openTicket !== null} onOpenChange={(o) => !o && setOpenTicket(null)}>
        <SheetContent side="right" className="flex w-full flex-col p-5 sm:max-w-lg">
          <SheetTitle className="sr-only">Ticket conversation</SheetTitle>
          {openTicket && (
            <TicketThread ticketId={openTicket} onClosed={() => setOpenTicket(null)} />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

export default function AdminTicketsPage() {
  return (
    <LivePage>
      <PageHeader
        title="Tickets"
        description="Reply to join a ticket — the user sees when you jump in."
      />
      <TicketQueue />
    </LivePage>
  );
}
