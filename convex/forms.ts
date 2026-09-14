import {
  action,
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { getFormDef } from "../lib/forms-def";
import { requireUser, requireAdmin, getAdminOrNull, getPrimaryWorkspace } from "./lib/auth";
import { encryptString, decryptString } from "./lib/crypto";
import { sendEmail } from "./lib/email";
import { notify } from "./notifications";

const fileValidator = v.array(
  v.object({ field: v.string(), storageId: v.id("_storage"), name: v.string() }),
);

/**
 * Public entry point. Validates against the form definition, encrypts
 * sensitive fields, stores the submission, then notifies team + admin with
 * WHO filled WHICH form only — never the contents.
 */
export const submit = action({
  args: {
    formSlug: v.string(),
    data: v.any(),
    files: v.optional(fileValidator),
  },
  handler: async (ctx, args): Promise<Id<"formSubmissions">> => {
    const def = getFormDef(args.formSlug);
    if (!def) throw new Error("Unknown form");

    const data = { ...(args.data as Record<string, unknown>) };
    for (const field of def.fields) {
      if (field.type === "file") continue;
      const value = data[field.name];
      const empty =
        value === undefined || value === null || String(value).trim() === "";
      if (field.required && empty) {
        throw new Error(`Missing required field: ${field.label}`);
      }
      if (field.sensitive && !empty) {
        data[field.name] = { encrypted: await encryptString(String(value)) };
      }
    }

    const { submissionId, userEmail, userName } = await ctx.runMutation(
      internal.forms.insertSubmission,
      { formSlug: args.formSlug, data, files: args.files },
    );

    // Identity + form name only, per policy — details live in the admin panel.
    const [adminEmail, teamEmail] = await Promise.all([
      ctx.runQuery(internal.config.getValue, { key: "adminNotificationEmail" }),
      ctx.runQuery(internal.config.getValue, { key: "teamNotificationEmail" }),
    ]);
    const recipients = [adminEmail, teamEmail]
      .map((e) => String(e ?? "").trim())
      .filter(Boolean);
    if (recipients.length > 0) {
      await sendEmail({
        to: recipients,
        subject: `New form submission: ${def.title}`,
        html: `<p><strong>${userName ?? userEmail}</strong> (${userEmail}) submitted the <strong>${def.formTitle}</strong> form.</p><p>Review it in the admin panel → Form Submissions.</p>`,
      });
    }

    return submissionId;
  },
});

export const insertSubmission = internalMutation({
  args: {
    formSlug: v.string(),
    data: v.any(),
    files: v.optional(fileValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) throw new Error("No workspace");
    const submissionId = await ctx.db.insert("formSubmissions", {
      workspaceId: workspace._id,
      userId: user._id,
      formSlug: args.formSlug,
      data: args.data,
      files: args.files,
      status: "processing",
    });
    return { submissionId, userEmail: user.email, userName: user.name };
  },
});

/** The signed-in user's own submissions, newest first. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return [];
    const submissions = await ctx.db
      .query("formSubmissions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
    return submissions.map((s) => ({
      _id: s._id,
      _creationTime: s._creationTime,
      formSlug: s.formSlug,
      status: s.status,
    }));
  },
});

// ── Admin ────────────────────────────────────────────────────────────────

export const adminList = query({
  args: {
    status: v.optional(
      v.union(v.literal("processing"), v.literal("active"), v.literal("closed")),
    ),
  },
  handler: async (ctx, args) => {
    if (!(await getAdminOrNull(ctx, "regular"))) return [];
    const submissions = args.status
      ? await ctx.db
          .query("formSubmissions")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .order("desc")
          .take(100)
      : await ctx.db.query("formSubmissions").order("desc").take(100);
    return await Promise.all(
      submissions.map(async (s) => {
        const user = await ctx.db.get(s.userId);
        return {
          _id: s._id,
          _creationTime: s._creationTime,
          formSlug: s.formSlug,
          status: s.status,
          userEmail: user?.email ?? "unknown",
          userName: user?.name,
        };
      }),
    );
  },
});

/** One of MY submissions — sensitive values masked, file URLs resolved. */
export const getMine = query({
  args: { id: v.id("formSubmissions") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return null;
    const submission = await ctx.db.get(args.id);
    if (!submission || submission.userId !== user._id) return null;
    const def = getFormDef(submission.formSlug);

    const data = { ...(submission.data as Record<string, unknown>) };
    for (const field of def?.fields ?? []) {
      const value = data[field.name];
      if (field.sensitive && value && typeof value === "object") {
        data[field.name] = "••••••••";
      }
    }

    const files = await Promise.all(
      (submission.files ?? []).map(async (f) => ({
        field: f.field,
        name: f.name,
        url: await ctx.storage.getUrl(f.storageId),
      })),
    );

    return {
      _id: submission._id,
      _creationTime: submission._creationTime,
      formSlug: submission.formSlug,
      status: submission.status,
      data,
      files,
    };
  },
});

/** Full submission detail with sensitive values masked and file URLs resolved. */
export const adminGet = query({
  args: { id: v.id("formSubmissions") },
  handler: async (ctx, args) => {
    if (!(await getAdminOrNull(ctx, "regular"))) return null;
    const submission = await ctx.db.get(args.id);
    if (!submission) return null;
    const user = await ctx.db.get(submission.userId);
    const def = getFormDef(submission.formSlug);

    const data = { ...(submission.data as Record<string, unknown>) };
    for (const field of def?.fields ?? []) {
      const value = data[field.name];
      if (field.sensitive && value && typeof value === "object") {
        data[field.name] = "••••••••";
      }
    }

    const files = await Promise.all(
      (submission.files ?? []).map(async (f) => ({
        field: f.field,
        name: f.name,
        url: await ctx.storage.getUrl(f.storageId),
      })),
    );

    return {
      _id: submission._id,
      _creationTime: submission._creationTime,
      formSlug: submission.formSlug,
      status: submission.status,
      data,
      files,
      userEmail: user?.email ?? "unknown",
      userName: user?.name,
    };
  },
});

export const getForReveal = internalQuery({
  args: { id: v.id("formSubmissions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "super");
    return await ctx.db.get(args.id);
  },
});

/** Superadmin-only: decrypt the sensitive fields of one submission. */
export const revealSensitive = action({
  args: { id: v.id("formSubmissions") },
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const submission = await ctx.runQuery(internal.forms.getForReveal, {
      id: args.id,
    });
    if (!submission) throw new Error("Not found");
    const revealed: Record<string, string> = {};
    const data = submission.data as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) {
      if (
        value &&
        typeof value === "object" &&
        "encrypted" in (value as Record<string, unknown>)
      ) {
        revealed[key] = await decryptString(
          (value as { encrypted: string }).encrypted,
        );
      }
    }
    return revealed;
  },
});

/** Admin verifies payment happened off-platform, then marks active. */
export const setStatus = mutation({
  args: {
    id: v.id("formSubmissions"),
    status: v.union(v.literal("active"), v.literal("closed"), v.literal("processing")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, "regular");
    const submission = await ctx.db.get(args.id);
    if (!submission) throw new Error("Not found");
    await ctx.db.patch(args.id, {
      status: args.status,
      statusChangedBy: admin._id,
    });
    const def = getFormDef(submission.formSlug);
    if (args.status === "active") {
      await notify(ctx, {
        userId: submission.userId,
        type: "form_active",
        title: `${def?.title ?? "Your request"} is now active`,
        body: "Payment confirmed — our team has started on your request.",
        href: "/forms",
      });
    }
  },
});
