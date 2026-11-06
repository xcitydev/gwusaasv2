import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { getCurrentUser, getPrimaryWorkspace, requireUser } from "./lib/auth";

/**
 * Saved elements (characters, locations, props) — reused as references and
 * by typing @handle in any prompt. Table name kept as "characters".
 */

const MAX_ELEMENTS = 200;
const MAX_EXTRA_IMAGES = 4;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const kindArg = v.union(v.literal("character"), v.literal("location"), v.literal("prop"));

/** "Dre's Café #2" → "dres-cafe-2". */
export function slugHandle(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "element"
  );
}

/**
 * Each element's @handle: its stored one, or (older rows) one derived from
 * the name that doesn't clash with stored handles — oldest wins, dupes get -2.
 */
function withHandles<T extends Doc<"characters">>(rows: T[]): (T & { handle: string })[] {
  const taken = new Set(rows.map((r) => r.handle).filter((h): h is string => Boolean(h)));
  const derived = new Map<Id<"characters">, string>();
  for (const row of [...rows].sort((a, b) => a._creationTime - b._creationTime)) {
    if (row.handle) continue;
    const base = slugHandle(row.name);
    let handle = base;
    for (let n = 2; taken.has(handle); n++) handle = `${base}-${n}`;
    taken.add(handle);
    derived.set(row._id, handle);
  }
  return rows.map((row) => ({ ...row, handle: row.handle ?? derived.get(row._id)! }));
}

async function workspaceRows(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  return await ctx.db
    .query("characters")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(MAX_ELEMENTS + 1);
}

/** A clean, unused handle — or a user-facing error. */
async function claimHandle(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  wanted: string,
  self?: Id<"characters">,
): Promise<string> {
  const handle = wanted.trim().replace(/^@/, "").toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    throw new Error("Element ID: use letters, numbers, - or _ (up to 32), starting with a letter or number");
  }
  const rows = withHandles(await workspaceRows(ctx, workspaceId));
  if (rows.some((r) => r._id !== self && r.handle === handle)) {
    throw new Error(`@${handle} is already used by another element`);
  }
  return handle;
}

const cleanUrls = (urls: string[] | undefined) =>
  (urls ?? [])
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\/\S+$/i.test(u))
    .slice(0, MAX_EXTRA_IMAGES);

/** The workspace's saved elements, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return [];
    const rows = await ctx.db
      .query("characters")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(MAX_ELEMENTS);
    return withHandles(rows);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    imageUrl: v.optional(v.string()),
    generationId: v.optional(v.id("generations")),
    traits: v.optional(v.any()),
    kind: v.optional(kindArg),
    handle: v.optional(v.string()),
    description: v.optional(v.string()),
    extraImageUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const name = args.name.trim().slice(0, 60) || "My element";

    let imageUrl = args.imageUrl?.trim();
    let source: "influencer" | "upload" | "generation" = "upload";
    if (args.generationId) {
      // Saved from a render: take the image from our own record, not the client.
      const generation = await ctx.db.get(args.generationId);
      if (!generation || generation.workspaceId !== workspace._id) throw new Error("Not found");
      if (generation.status !== "done" || !generation.resultUrl) {
        throw new Error("That render isn't finished yet");
      }
      imageUrl = generation.resultUrl;
      source = generation.model === "ai-influencer" ? "influencer" : "generation";
    }
    if (!imageUrl || !/^https?:\/\/\S+$/i.test(imageUrl)) throw new Error("Add an image first");

    const existing = await workspaceRows(ctx, workspace._id);
    if (existing.length >= MAX_ELEMENTS) {
      throw new Error(`You can save up to ${MAX_ELEMENTS} elements — delete one first`);
    }
    const handle = await claimHandle(ctx, workspace._id, args.handle?.trim() || slugHandle(name));

    return await ctx.db.insert("characters", {
      workspaceId: workspace._id,
      userId: user._id,
      name,
      imageUrl,
      source,
      generationId: args.generationId,
      traits: args.traits,
      kind: args.kind,
      handle,
      description: args.description?.trim().slice(0, 500) || undefined,
      extraImageUrls: cleanUrls(args.extraImageUrls),
    });
  },
});

async function ownElement(ctx: MutationCtx, id: Id<"characters">) {
  const user = await requireUser(ctx);
  const workspace = await getPrimaryWorkspace(ctx, user._id);
  const element = await ctx.db.get(id);
  if (!workspace || !element || element.workspaceId !== workspace._id) {
    throw new Error("Not found");
  }
  return element;
}

/** Edit an element from the element dialog. */
export const update = mutation({
  args: {
    id: v.id("characters"),
    name: v.string(),
    kind: kindArg,
    handle: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    extraImageUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const element = await ownElement(ctx, args.id);
    const handle = await claimHandle(ctx, element.workspaceId, args.handle, element._id);
    const imageUrl = args.imageUrl?.trim();
    await ctx.db.patch(args.id, {
      name: args.name.trim().slice(0, 60) || element.name,
      kind: args.kind,
      handle,
      description: args.description?.trim().slice(0, 500) || undefined,
      // A trained face keeps its training photo as the cover.
      ...(imageUrl && /^https?:\/\/\S+$/i.test(imageUrl) && !element.soul && { imageUrl }),
      ...(args.extraImageUrls && { extraImageUrls: cleanUrls(args.extraImageUrls) }),
    });
  },
});

export const rename = mutation({
  args: { id: v.id("characters"), name: v.string() },
  handler: async (ctx, args) => {
    await ownElement(ctx, args.id);
    await ctx.db.patch(args.id, { name: args.name.trim().slice(0, 60) || "My element" });
  },
});

export const setKind = mutation({
  args: { id: v.id("characters"), kind: kindArg },
  handler: async (ctx, args) => {
    await ownElement(ctx, args.id);
    await ctx.db.patch(args.id, { kind: args.kind });
  },
});

export const remove = mutation({
  args: { id: v.id("characters") },
  handler: async (ctx, args) => {
    await ownElement(ctx, args.id);
    await ctx.db.delete(args.id);
  },
});
