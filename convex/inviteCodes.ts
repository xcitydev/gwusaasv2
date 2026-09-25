import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  getAdminOrNull,
  hasFormsAccess,
  requireAdmin,
  requireUser,
} from "./lib/auth";
import {
  INVITE_CODE_MAX,
  INVITE_CODE_MIN,
  normalizeInviteCode,
} from "../lib/invite-codes";

/**
 * Invite codes gate the GWU Onboarding Forms: a user who redeems one (at
 * sign-up via ?invite=CODE, or later in Settings) gets formsAccess on their
 * user row. Admins can also grant or revoke access directly.
 */

const INVALID = "That invite code is not valid.";
// No 0/O/1/I so codes survive being read out loud.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(): string {
  let code = "GWU";
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/** Redeem a code for the signed-in user. */
export const redeem = mutation({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<{ status: "unlocked" | "already" }> => {
    const user = await requireUser(ctx);
    if (hasFormsAccess(user)) return { status: "already" };
    const code = normalizeInviteCode(args.code);
    if (code.length < INVITE_CODE_MIN) throw new Error(INVALID);
    const invite = await ctx.db
      .query("inviteCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!invite || invite.status !== "active") throw new Error(INVALID);
    if (invite.expiresAt !== undefined && invite.expiresAt < Date.now()) {
      throw new Error("That invite code has expired.");
    }
    if (invite.maxUses !== undefined && invite.uses >= invite.maxUses) {
      throw new Error("That invite code has already been used.");
    }
    await ctx.db.patch(invite._id, { uses: invite.uses + 1 });
    await ctx.db.patch(user._id, {
      formsAccess: true,
      formsAccessSource: "invite",
      formsAccessAt: Date.now(),
      formsInviteCodeId: invite._id,
    });
    return { status: "unlocked" };
  },
});

// ── Admin ────────────────────────────────────────────────────────────────

export const adminList = query({
  args: {},
  handler: async (ctx) => {
    if (!(await getAdminOrNull(ctx, "regular"))) return [];
    const codes = await ctx.db.query("inviteCodes").order("desc").take(200);
    const now = Date.now();
    return await Promise.all(
      codes.map(async (c) => {
        const creator = await ctx.db.get(c.createdBy);
        // Resolved here so the UI never has to read the clock during render.
        const state: "active" | "revoked" | "expired" | "used up" =
          c.status === "revoked"
            ? "revoked"
            : c.expiresAt !== undefined && c.expiresAt < now
              ? "expired"
              : c.maxUses !== undefined && c.uses >= c.maxUses
                ? "used up"
                : "active";
        return {
          state,
          _id: c._id,
          _creationTime: c._creationTime,
          code: c.code,
          label: c.label,
          uses: c.uses,
          maxUses: c.maxUses,
          expiresAt: c.expiresAt,
          status: c.status,
          createdBy: creator?.email ?? "—",
        };
      }),
    );
  },
});

export const adminCreate = mutation({
  args: {
    label: v.optional(v.string()),
    // Omit for unlimited uses.
    maxUses: v.optional(v.number()),
    expiresInDays: v.optional(v.number()),
    // Optional custom code (e.g. a client name); generated when omitted.
    code: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const admin = await requireAdmin(ctx, "regular");
    let code: string;
    if (args.code && args.code.trim()) {
      code = normalizeInviteCode(args.code);
      if (code.length < INVITE_CODE_MIN || code.length > INVITE_CODE_MAX) {
        throw new Error(
          `Custom codes need ${INVITE_CODE_MIN}–${INVITE_CODE_MAX} letters or digits`,
        );
      }
      const clash = await ctx.db
        .query("inviteCodes")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      if (clash) throw new Error("That code already exists");
    } else {
      code = randomCode();
      while (
        await ctx.db
          .query("inviteCodes")
          .withIndex("by_code", (q) => q.eq("code", code))
          .unique()
      ) {
        code = randomCode();
      }
    }
    if (args.maxUses !== undefined && (!Number.isInteger(args.maxUses) || args.maxUses < 1)) {
      throw new Error("Uses must be a whole number of at least 1");
    }
    if (args.expiresInDays !== undefined && !(args.expiresInDays > 0)) {
      throw new Error("Expiry must be a positive number of days");
    }
    await ctx.db.insert("inviteCodes", {
      code,
      label: args.label?.trim() || undefined,
      createdBy: admin._id,
      maxUses: args.maxUses,
      uses: 0,
      expiresAt:
        args.expiresInDays !== undefined
          ? Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000
          : undefined,
      status: "active",
    });
    return code;
  },
});

export const adminRevoke = mutation({
  args: { id: v.id("inviteCodes") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "regular");
    const invite = await ctx.db.get(args.id);
    if (!invite) throw new Error("Invite code not found");
    await ctx.db.patch(args.id, { status: "revoked" });
  },
});

/** Grant or revoke forms access for one user without a code ("upgraded by admin"). */
export const adminSetFormsAccess = mutation({
  args: { userId: v.id("users"), hasAccess: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, "regular");
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    if (args.hasAccess) {
      await ctx.db.patch(args.userId, {
        formsAccess: true,
        formsAccessSource: "admin",
        formsAccessAt: Date.now(),
      });
    } else {
      await ctx.db.patch(args.userId, {
        formsAccess: false,
        formsAccessSource: undefined,
        formsAccessAt: undefined,
        formsInviteCodeId: undefined,
      });
    }
  },
});

/**
 * One-off migration: anyone who already submitted a form before the gate
 * existed keeps access (recorded as an admin grant so it can be revoked).
 */
export const backfillLegacyAccess = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ granted: number }> => {
    const submissions = await ctx.db.query("formSubmissions").collect();
    const userIds = new Set(submissions.map((s) => s.userId));
    let granted = 0;
    for (const userId of userIds) {
      const user = await ctx.db.get(userId);
      if (!user || user.formsAccess) continue;
      await ctx.db.patch(userId, {
        formsAccess: true,
        formsAccessSource: "admin",
        formsAccessAt: Date.now(),
      });
      granted++;
    }
    return { granted };
  },
});
