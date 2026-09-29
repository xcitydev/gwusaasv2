import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser, getPrimaryWorkspace, requireUser } from "./lib/auth";
import { decryptString, encryptString } from "./lib/crypto";
import type { MeetingNotes, TaskRouting, TaskRoutingResult } from "../lib/note-taker";

/**
 * Task-tool integrations (Settings → Integrations) and action-item routing.
 * After the AI writes a meeting's notes, every connected tool with
 * auto-send on receives the action items as tasks: Trello cards, Asana
 * tasks, or a JSON webhook for anything else (Zapier, Make, n8n…). Secrets
 * are encrypted at rest and never leave the server.
 */

export const providerValidator = v.union(
  v.literal("trello"),
  v.literal("asana"),
  v.literal("webhook"),
);

type TrelloSecret = { key: string; token: string };
type AsanaSecret = { pat: string };
type WebhookSecret = { secret: string | null };

const TRELLO = "https://api.trello.com/1";
const ASANA = "https://app.asana.com/api/1.0";

function friendly(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return (message.split("Uncaught Error: ").pop() || fallback).slice(0, 200);
}

async function callerWorkspace(ctx: Parameters<typeof getCurrentUser>[0]) {
  const user = await getCurrentUser(ctx);
  if (!user) return null;
  const workspace = await getPrimaryWorkspace(ctx, user._id);
  if (!workspace) return null;
  return { user, workspace };
}

// ── Reads ───────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    const caller = await callerWorkspace(ctx);
    if (!caller) return [];
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_workspace_provider", (q) => q.eq("workspaceId", caller.workspace._id))
      .collect();
    return rows.map((r) => ({
      provider: r.provider,
      status: r.status,
      label: r.label ?? null,
      config: (r.config ?? {}) as Record<string, string>,
      autoRoute: r.autoRoute,
      updatedAt: r.updatedAt,
      lastError: r.lastError ?? null,
    }));
  },
});

/** The caller's row for one provider (auth flows through from the action). */
export const getMine = internalQuery({
  args: { provider: providerValidator },
  handler: async (ctx, args) => {
    const caller = await callerWorkspace(ctx);
    if (!caller) return null;
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", caller.workspace._id).eq("provider", args.provider),
      )
      .unique();
    return row ? { row, userId: caller.user._id, workspaceId: caller.workspace._id } : null;
  },
});

export const callerContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const caller = await callerWorkspace(ctx);
    return caller ? { userId: caller.user._id, workspaceId: caller.workspace._id } : null;
  },
});

export const getMeetingForRouting = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return null;
    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_workspace_provider", (q) => q.eq("workspaceId", meeting.workspaceId))
      .collect();
    return { meeting, integrations };
  },
});

export const ownMeetingForRouting = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const caller = await callerWorkspace(ctx);
    if (!caller) return null;
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting || meeting.workspaceId !== caller.workspace._id) return null;
    return meeting._id;
  },
});

// ── Writes ──────────────────────────────────────────────────────────────

export const upsert = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    provider: providerValidator,
    secret: v.string(),
    config: v.any(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("provider", args.provider),
      )
      .unique();
    const patch = {
      status: "connected" as const,
      secret: args.secret,
      config: args.config,
      label: args.label,
      updatedAt: Date.now(),
      lastError: undefined,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else {
      await ctx.db.insert("integrations", {
        workspaceId: args.workspaceId,
        provider: args.provider,
        autoRoute: true,
        connectedBy: args.userId,
        ...patch,
      });
    }
  },
});

export const markError = internalMutation({
  args: { workspaceId: v.id("workspaces"), provider: providerValidator, error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("provider", args.provider),
      )
      .unique();
    if (row) await ctx.db.patch(row._id, { status: "error", lastError: args.error.slice(0, 200) });
  },
});

export const storeRouting = internalMutation({
  args: { meetingId: v.id("meetings"), taskRouting: v.any() },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return;
    await ctx.db.patch(args.meetingId, { taskRouting: args.taskRouting });
  },
});

export const disconnect = mutation({
  args: { provider: providerValidator },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", workspace._id).eq("provider", args.provider),
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

export const setAutoRoute = mutation({
  args: { provider: providerValidator, autoRoute: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", workspace._id).eq("provider", args.provider),
      )
      .unique();
    if (!row) throw new Error("Not connected");
    await ctx.db.patch(row._id, { autoRoute: args.autoRoute, updatedAt: Date.now() });
  },
});

/** Pick the board/list (Trello) or workspace/project (Asana) tasks go to. */
export const setTarget = mutation({
  args: { provider: providerValidator, config: v.any() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_workspace_provider", (q) =>
        q.eq("workspaceId", workspace._id).eq("provider", args.provider),
      )
      .unique();
    if (!row) throw new Error("Not connected");
    const incoming = args.config as Record<string, unknown>;
    const safe: Record<string, string> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (typeof value === "string") safe[key] = value.slice(0, 200);
    }
    await ctx.db.patch(row._id, {
      config: { ...((row.config ?? {}) as Record<string, string>), ...safe },
      status: "connected",
      lastError: undefined,
      updatedAt: Date.now(),
    });
  },
});

// ── Provider clients ────────────────────────────────────────────────────

async function trelloGet<T>(secret: TrelloSecret, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${TRELLO}${path}`);
  url.searchParams.set("key", secret.key);
  url.searchParams.set("token", secret.token);
  for (const [k, val] of Object.entries(params)) url.searchParams.set(k, val);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Trello ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as T;
}

async function trelloPost<T>(secret: TrelloSecret, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${TRELLO}${path}`);
  url.searchParams.set("key", secret.key);
  url.searchParams.set("token", secret.token);
  for (const [k, val] of Object.entries(params)) if (val) url.searchParams.set(k, val);
  const res = await fetch(url, { method: "POST", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Trello ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as T;
}

async function asanaRequest<T>(secret: AsanaSecret, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ASANA}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret.pat}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Asana ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as T;
}

/** Name → member id: exact full name, then first name. */
function matchByName<T extends { id: string; name: string }>(owner: string | null, people: T[]): T | null {
  if (!owner) return null;
  const wanted = owner.trim().toLowerCase();
  if (!wanted) return null;
  const exact = people.find((p) => p.name.trim().toLowerCase() === wanted);
  if (exact) return exact;
  const first = wanted.split(/\s+/)[0];
  const byFirst = people.filter((p) => p.name.trim().toLowerCase().split(/\s+/)[0] === first);
  return byFirst.length === 1 ? byFirst[0] : null;
}

function parseDue(due: string | null): Date | null {
  if (!due) return null;
  const ms = Date.parse(due);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  return date.getFullYear() > 2000 ? date : null;
}

function describe(meeting: Doc<"meetings">, item: { owner: string | null; due: string | null }, dueParsed: Date | null): string {
  const notes = meeting.notes as MeetingNotes | undefined;
  const lines = [
    `From the meeting "${meeting.title}" on ${new Date(meeting.endedAt ?? meeting._creationTime).toDateString()}.`,
  ];
  if (item.owner) lines.push(`Owner: ${item.owner}`);
  if (item.due && !dueParsed) lines.push(`Due (as said): ${item.due}`);
  if (notes?.summary) lines.push("", notes.summary);
  return lines.join("\n").slice(0, 4000);
}

// ── Connect / browse ────────────────────────────────────────────────────

export const connectTrello = action({
  args: { key: v.string(), token: v.string() },
  handler: async (ctx, args): Promise<{ boards: { id: string; name: string }[] }> => {
    const caller = await ctx.runQuery(internal.integrations.callerContext, {});
    if (!caller) throw new Error("Not signed in");
    const secret: TrelloSecret = { key: args.key.trim(), token: args.token.trim() };
    if (!secret.key || !secret.token) throw new Error("Paste both the API key and the token");
    let me: { fullName?: string; username?: string };
    try {
      me = await trelloGet(secret, "/members/me", { fields: "fullName,username" });
    } catch (error) {
      throw new Error(`Trello rejected those credentials (${friendly(error, "unknown error")})`);
    }
    const boards = await trelloGet<{ id: string; name: string; closed?: boolean }[]>(
      secret,
      "/members/me/boards",
      { fields: "name,closed", filter: "open" },
    );
    await ctx.runMutation(internal.integrations.upsert, {
      workspaceId: caller.workspaceId,
      userId: caller.userId,
      provider: "trello",
      secret: await encryptString(JSON.stringify(secret)),
      config: {},
      label: me.fullName || me.username || "Trello",
    });
    return { boards: boards.filter((b) => !b.closed).map((b) => ({ id: b.id, name: b.name })) };
  },
});

export const trelloBoards = action({
  args: {},
  handler: async (ctx): Promise<{ id: string; name: string }[]> => {
    const mine = await ctx.runQuery(internal.integrations.getMine, { provider: "trello" });
    if (!mine) throw new Error("Trello is not connected");
    const secret = JSON.parse(await decryptString(mine.row.secret)) as TrelloSecret;
    const boards = await trelloGet<{ id: string; name: string; closed?: boolean }[]>(
      secret,
      "/members/me/boards",
      { fields: "name,closed", filter: "open" },
    );
    return boards.filter((b) => !b.closed).map((b) => ({ id: b.id, name: b.name }));
  },
});

export const trelloLists = action({
  args: { boardId: v.string() },
  handler: async (ctx, args): Promise<{ id: string; name: string }[]> => {
    const mine = await ctx.runQuery(internal.integrations.getMine, { provider: "trello" });
    if (!mine) throw new Error("Trello is not connected");
    const secret = JSON.parse(await decryptString(mine.row.secret)) as TrelloSecret;
    const lists = await trelloGet<{ id: string; name: string; closed?: boolean }[]>(
      secret,
      `/boards/${encodeURIComponent(args.boardId)}/lists`,
      { fields: "name,closed" },
    );
    return lists.filter((l) => !l.closed).map((l) => ({ id: l.id, name: l.name }));
  },
});

export const connectAsana = action({
  args: { pat: v.string() },
  handler: async (ctx, args): Promise<{ workspaces: { gid: string; name: string }[] }> => {
    const caller = await ctx.runQuery(internal.integrations.callerContext, {});
    if (!caller) throw new Error("Not signed in");
    const secret: AsanaSecret = { pat: args.pat.trim() };
    if (!secret.pat) throw new Error("Paste your Asana personal access token");
    let me: { data?: { name?: string; workspaces?: { gid: string; name: string }[] } };
    try {
      me = await asanaRequest(secret, "/users/me?opt_fields=name,workspaces.name");
    } catch (error) {
      throw new Error(`Asana rejected that token (${friendly(error, "unknown error")})`);
    }
    await ctx.runMutation(internal.integrations.upsert, {
      workspaceId: caller.workspaceId,
      userId: caller.userId,
      provider: "asana",
      secret: await encryptString(JSON.stringify(secret)),
      config: {},
      label: me.data?.name || "Asana",
    });
    return { workspaces: me.data?.workspaces ?? [] };
  },
});

export const asanaWorkspaces = action({
  args: {},
  handler: async (ctx): Promise<{ gid: string; name: string }[]> => {
    const mine = await ctx.runQuery(internal.integrations.getMine, { provider: "asana" });
    if (!mine) throw new Error("Asana is not connected");
    const secret = JSON.parse(await decryptString(mine.row.secret)) as AsanaSecret;
    const me = await asanaRequest<{ data?: { workspaces?: { gid: string; name: string }[] } }>(
      secret,
      "/users/me?opt_fields=workspaces.name",
    );
    return me.data?.workspaces ?? [];
  },
});

export const asanaProjects = action({
  args: { workspaceGid: v.string() },
  handler: async (ctx, args): Promise<{ gid: string; name: string }[]> => {
    const mine = await ctx.runQuery(internal.integrations.getMine, { provider: "asana" });
    if (!mine) throw new Error("Asana is not connected");
    const secret = JSON.parse(await decryptString(mine.row.secret)) as AsanaSecret;
    const result = await asanaRequest<{ data?: { gid: string; name: string }[] }>(
      secret,
      `/projects?workspace=${encodeURIComponent(args.workspaceGid)}&archived=false&limit=100&opt_fields=name`,
    );
    return result.data ?? [];
  },
});

export const connectWebhook = action({
  args: { url: v.string(), secret: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const caller = await ctx.runQuery(internal.integrations.callerContext, {});
    if (!caller) throw new Error("Not signed in");
    const url = args.url.trim();
    if (!/^https:\/\/\S+$/.test(url)) throw new Error("The webhook must be an https:// URL");
    const secret: WebhookSecret = { secret: args.secret?.trim() || null };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret.secret ? { "X-GWU-Secret": secret.secret } : {}),
      },
      body: JSON.stringify({ type: "ping", sentAt: new Date().toISOString() }),
    }).catch((error: unknown) => {
      throw new Error(`Could not reach the webhook (${friendly(error, "network error")})`);
    });
    if (!res.ok) throw new Error(`The webhook answered ${res.status} to the test ping`);
    await ctx.runMutation(internal.integrations.upsert, {
      workspaceId: caller.workspaceId,
      userId: caller.userId,
      provider: "webhook",
      secret: await encryptString(JSON.stringify(secret)),
      config: { url },
      label: new URL(url).hostname,
    });
  },
});

// ── Routing ─────────────────────────────────────────────────────────────

async function routeToTrello(
  meeting: Doc<"meetings">,
  row: Doc<"integrations">,
  items: MeetingNotes["actionItems"],
): Promise<TaskRoutingResult> {
  const config = (row.config ?? {}) as { boardId?: string; listId?: string };
  if (!config.listId) {
    return { provider: "trello", ok: false, created: 0, error: "Pick a board and list in Settings → Integrations", links: [] };
  }
  const secret = JSON.parse(await decryptString(row.secret)) as TrelloSecret;
  let members: { id: string; name: string }[] = [];
  if (config.boardId) {
    try {
      const raw = await trelloGet<{ id: string; fullName?: string; username?: string }[]>(
        secret,
        `/boards/${encodeURIComponent(config.boardId)}/members`,
        { fields: "fullName,username" },
      );
      members = raw.map((m) => ({ id: m.id, name: m.fullName || m.username || "" }));
    } catch {
      members = [];
    }
  }
  const links: { task: string; url: string | null }[] = [];
  for (const item of items) {
    const due = parseDue(item.due);
    const member = matchByName(item.owner, members);
    const card = await trelloPost<{ id: string; shortUrl?: string; url?: string }>(secret, "/cards", {
      idList: config.listId,
      name: item.task.slice(0, 500),
      desc: describe(meeting, item, due),
      due: due ? due.toISOString() : "",
      idMembers: member ? member.id : "",
    });
    links.push({ task: item.task, url: card.shortUrl ?? card.url ?? null });
  }
  return { provider: "trello", ok: true, created: links.length, links };
}

async function routeToAsana(
  meeting: Doc<"meetings">,
  row: Doc<"integrations">,
  items: MeetingNotes["actionItems"],
): Promise<TaskRoutingResult> {
  const config = (row.config ?? {}) as { workspaceGid?: string; projectGid?: string };
  if (!config.workspaceGid || !config.projectGid) {
    return { provider: "asana", ok: false, created: 0, error: "Pick a workspace and project in Settings → Integrations", links: [] };
  }
  const secret = JSON.parse(await decryptString(row.secret)) as AsanaSecret;
  let users: { id: string; name: string }[] = [];
  try {
    const raw = await asanaRequest<{ data?: { gid: string; name: string }[] }>(
      secret,
      `/users?workspace=${encodeURIComponent(config.workspaceGid)}&opt_fields=name&limit=100`,
    );
    users = (raw.data ?? []).map((u) => ({ id: u.gid, name: u.name }));
  } catch {
    users = [];
  }
  const links: { task: string; url: string | null }[] = [];
  for (const item of items) {
    const due = parseDue(item.due);
    const assignee = matchByName(item.owner, users);
    const created = await asanaRequest<{ data?: { gid: string; permalink_url?: string } }>(secret, "/tasks", {
      method: "POST",
      body: JSON.stringify({
        data: {
          name: item.task.slice(0, 1000),
          notes: describe(meeting, item, due),
          workspace: config.workspaceGid,
          projects: [config.projectGid],
          ...(due && { due_on: due.toISOString().slice(0, 10) }),
          ...(assignee && { assignee: assignee.id }),
        },
      }),
    });
    links.push({ task: item.task, url: created.data?.permalink_url ?? null });
  }
  return { provider: "asana", ok: true, created: links.length, links };
}

async function routeToWebhook(
  meeting: Doc<"meetings">,
  row: Doc<"integrations">,
  items: MeetingNotes["actionItems"],
): Promise<TaskRoutingResult> {
  const config = (row.config ?? {}) as { url?: string };
  if (!config.url) return { provider: "webhook", ok: false, created: 0, error: "No URL saved", links: [] };
  const secret = JSON.parse(await decryptString(row.secret)) as WebhookSecret;
  const notes = meeting.notes as MeetingNotes | undefined;
  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret.secret ? { "X-GWU-Secret": secret.secret } : {}),
    },
    body: JSON.stringify({
      type: "meeting.action_items",
      meeting: {
        id: meeting._id,
        title: meeting.title,
        endedAt: meeting.endedAt ? new Date(meeting.endedAt).toISOString() : null,
        summary: notes?.summary ?? null,
        decisions: notes?.decisions ?? [],
      },
      actionItems: items.map((item) => ({
        task: item.task,
        owner: item.owner,
        due: item.due,
        dueDate: parseDue(item.due)?.toISOString().slice(0, 10) ?? null,
      })),
    }),
  });
  if (!res.ok) throw new Error(`Webhook answered ${res.status}`);
  return { provider: "webhook", ok: true, created: items.length, links: items.map((i) => ({ task: i.task, url: null })) };
}

async function runRouting(ctx: ActionCtx, meetingId: Id<"meetings">, force: boolean): Promise<TaskRouting | null> {
  const data = await ctx.runQuery(internal.integrations.getMeetingForRouting, { meetingId });
  if (!data) return null;
  const { meeting } = data;
  const notes = meeting.notes as MeetingNotes | undefined;
  const items = notes?.actionItems ?? [];
  const existing = meeting.taskRouting as TaskRouting | undefined;
  if (existing && !force) return existing;
  const targets = data.integrations.filter((row) => row.status !== "error" || force).filter((row) => force || row.autoRoute);
  if (targets.length === 0 || items.length === 0) {
    const routing: TaskRouting = { at: Date.now(), results: [] };
    if (force || items.length === 0) {
      await ctx.runMutation(internal.integrations.storeRouting, { meetingId, taskRouting: routing });
    }
    return routing;
  }
  const results: TaskRoutingResult[] = [];
  for (const row of targets) {
    try {
      const result =
        row.provider === "trello"
          ? await routeToTrello(meeting, row, items)
          : row.provider === "asana"
            ? await routeToAsana(meeting, row, items)
            : await routeToWebhook(meeting, row, items);
      results.push(result);
      if (!result.ok && result.error) {
        await ctx.runMutation(internal.integrations.markError, {
          workspaceId: meeting.workspaceId,
          provider: row.provider,
          error: result.error,
        });
      }
    } catch (error) {
      const message = friendly(error, "Failed");
      results.push({ provider: row.provider, ok: false, created: 0, error: message, links: [] });
      await ctx.runMutation(internal.integrations.markError, {
        workspaceId: meeting.workspaceId,
        provider: row.provider,
        error: message,
      });
    }
  }
  const routing: TaskRouting = { at: Date.now(), results };
  await ctx.runMutation(internal.integrations.storeRouting, { meetingId, taskRouting: routing });
  return routing;
}

/** Scheduled by storeNotes once the notes are ready. Idempotent. */
export const routeActionItems = internalAction({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<void> => {
    await runRouting(ctx, args.meetingId, false);
  },
});

/** "Send action items now" — re-sends even if a previous run happened. */
export const routeNow = action({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args): Promise<TaskRouting | null> => {
    const own = await ctx.runQuery(internal.integrations.ownMeetingForRouting, {
      meetingId: args.meetingId,
    });
    if (!own) throw new Error("Meeting not found");
    return await runRouting(ctx, own, true);
  },
});
