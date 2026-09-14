import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUser, getAdminOrNull, getCurrentUser, getPrimaryWorkspace } from "./lib/auth";
import { notify } from "./notifications";

export const create = mutation({
  args: { subject: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    if (!args.subject.trim() || !args.body.trim()) {
      throw new Error("Subject and message are required");
    }
    const ticketId = await ctx.db.insert("tickets", {
      workspaceId: workspace._id,
      userId: user._id,
      subject: args.subject.trim(),
      status: "open",
      lastMessageAt: Date.now(),
    });
    await ctx.db.insert("ticketMessages", {
      ticketId,
      authorId: user._id,
      isAdmin: false,
      kind: "message",
      body: args.body.trim(),
    });
    return ticketId;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("tickets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
  },
});

export const get = query({
  args: { id: v.id("tickets") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const ticket = await ctx.db.get(args.id);
    if (!ticket) return null;
    const isOwner = ticket.userId === user._id;
    const isAdmin = Boolean(user.adminRole);
    if (!isOwner && !isAdmin) return null;

    const messages = await ctx.db
      .query("ticketMessages")
      .withIndex("by_ticket", (q) => q.eq("ticketId", args.id))
      .collect();
    const owner = await ctx.db.get(ticket.userId);
    return {
      ...ticket,
      userEmail: owner?.email,
      userName: owner?.name,
      messages: await Promise.all(
        messages.map(async (m) => {
          const author = m.authorId ? await ctx.db.get(m.authorId) : null;
          return {
            _id: m._id,
            _creationTime: m._creationTime,
            kind: m.kind,
            isAdmin: m.isAdmin,
            body: m.body,
            authorName: author?.name ?? author?.email ?? "Unknown",
            isMe: m.authorId === user._id,
          };
        }),
      ),
    };
  },
});

export const reply = mutation({
  args: { id: v.id("tickets"), body: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const ticket = await ctx.db.get(args.id);
    if (!ticket) throw new Error("Not found");
    const isOwner = ticket.userId === user._id;
    const isAdmin = Boolean(user.adminRole);
    if (!isOwner && !isAdmin) throw new Error("Not allowed");
    if (!args.body.trim()) throw new Error("Message is required");
    if (ticket.status === "closed") throw new Error("Ticket is closed");

    // First admin interaction announces itself so the user sees who joined.
    if (isAdmin && !isOwner) {
      const messages = await ctx.db
        .query("ticketMessages")
        .withIndex("by_ticket", (q) => q.eq("ticketId", args.id))
        .collect();
      const alreadyJoined = messages.some(
        (m) => m.authorId === user._id && m.isAdmin,
      );
      if (!alreadyJoined) {
        await ctx.db.insert("ticketMessages", {
          ticketId: args.id,
          authorId: user._id,
          isAdmin: true,
          kind: "event",
          body: `${user.name ?? user.email} joined the ticket`,
        });
      }
    }

    await ctx.db.insert("ticketMessages", {
      ticketId: args.id,
      authorId: user._id,
      isAdmin: isAdmin && !isOwner,
      kind: "message",
      body: args.body.trim(),
    });
    await ctx.db.patch(args.id, {
      lastMessageAt: Date.now(),
      status: isAdmin && !isOwner ? "answered" : "open",
    });

    if (isAdmin && !isOwner) {
      await notify(ctx, {
        userId: ticket.userId,
        type: "ticket_reply",
        title: "Support replied to your ticket",
        body: ticket.subject,
        href: `/support?ticket=${args.id}`,
      });
    }
  },
});

export const close = mutation({
  args: { id: v.id("tickets") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const ticket = await ctx.db.get(args.id);
    if (!ticket) throw new Error("Not found");
    if (ticket.userId !== user._id && !user.adminRole) {
      throw new Error("Not allowed");
    }
    await ctx.db.patch(args.id, { status: "closed" });
  },
});

export const adminList = query({
  args: {
    status: v.optional(
      v.union(v.literal("open"), v.literal("answered"), v.literal("closed")),
    ),
  },
  handler: async (ctx, args) => {
    if (!(await getAdminOrNull(ctx, "regular"))) return [];
    const tickets = args.status
      ? await ctx.db
          .query("tickets")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .order("desc")
          .take(100)
      : await ctx.db.query("tickets").order("desc").take(100);
    return await Promise.all(
      tickets.map(async (t) => {
        const owner = await ctx.db.get(t.userId);
        return { ...t, userEmail: owner?.email, userName: owner?.name };
      }),
    );
  },
});
