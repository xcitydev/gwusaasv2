import { mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";

/** A fresh upload may be claimed by its uploader for this long. */
const CLAIM_WINDOW_MS = 60 * 60 * 1000;

/**
 * Bind a storage file to the user who uploaded it. generateUploadUrl can't
 * know the id, so the first caller to present a FRESH, unclaimed id owns it;
 * older unclaimed files (and anyone else's) are refused. Storage ids are
 * unguessable, so the claim window only has to beat a leaked id.
 */
export async function claimUpload(
  ctx: MutationCtx,
  user: Doc<"users">,
  storageId: Id<"_storage">,
): Promise<void> {
  const existing = await ctx.db
    .query("uploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  if (existing) {
    if (existing.userId !== user._id) throw new Error("Upload not found");
    return;
  }
  const file = await ctx.db.system.get(storageId);
  if (!file || Date.now() - file._creationTime > CLAIM_WINDOW_MS) {
    throw new Error("Upload not found");
  }
  await ctx.db.insert("uploads", {
    storageId,
    userId: user._id,
    createdAt: Date.now(),
  });
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Record the caller as the owner of a file they just uploaded. */
export const registerUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await claimUpload(ctx, user, args.storageId);
  },
});

/** Public URL for an uploaded file — e.g. a reference image handed to fal. */
export const getPublicUrl = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    // Only the uploader may resolve it (claims a fresh upload on first call).
    await claimUpload(ctx, user, args.storageId);
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new Error("Upload not found");
    return url;
  },
});
