import { ConvexError } from "convex/values";
import { action as rawAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { extractErrorText, toPublicError, type ErrorArea } from "../../lib/public-errors";

/** "convex/voiceActions.ts:412" from a stack, so admins see where it broke. */
function sourceFromStack(e: unknown, fallback: string): string {
  const stack = e instanceof Error ? (e.stack ?? "") : "";
  const m = stack.match(/convex[\\/]([\w./\\-]+\.ts):(\d+)/);
  return m ? `${m[1].replace(/\\/g, "/")}:${m[2]}` : fallback;
}

/**
 * Turn a failure into what the user may see. Vendor-branded or technical
 * errors are replaced with friendly copy and logged as an admin incident;
 * our own user-facing messages pass through unchanged. Returns the public
 * message (callers that store errors on rows use this directly).
 */
export async function publicFailure(
  ctx: Pick<ActionCtx, "runMutation">,
  error: unknown,
  opts: {
    source?: string;
    area?: ErrorArea;
    userId?: import("../_generated/dataModel").Id<"users">;
    workspaceId?: import("../_generated/dataModel").Id<"workspaces">;
  } = {},
): Promise<{ message: string; hidden: boolean }> {
  const raw =
    error instanceof ConvexError && typeof error.data === "string"
      ? error.data
      : extractErrorText(error) || (error instanceof Error ? error.message : String(error));
  const pub = toPublicError(raw, opts.area);
  if (!pub.hidden) return { message: pub.message, hidden: false };
  console.error(`[incident] ${opts.source ?? "unknown"}:`, raw);
  try {
    await ctx.runMutation(internal.incidents.record, {
      area: pub.area,
      vendor: pub.vendor,
      source: sourceFromStack(error, opts.source ?? "action"),
      message: raw,
      userId: opts.userId,
      workspaceId: opts.workspaceId,
    });
  } catch (reportError) {
    console.error("Could not record incident:", reportError);
  }
  // Keep the NOT_CONFIGURED code so client branches can still tell
  // "feature switched off" apart from a transient failure.
  const message = /NOT_CONFIGURED/.test(raw) ? `NOT_CONFIGURED: ${pub.message}` : pub.message;
  return { message, hidden: true };
}

/**
 * Drop-in replacement for Convex's `action`: any error a public action throws
 * is sanitized (see publicFailure) before it reaches the browser. Thrown as a
 * ConvexError so the friendly text also survives production redaction.
 */
export const action = ((definition: Parameters<typeof rawAction>[0]) => {
  const def =
    typeof definition === "function"
      ? { handler: definition }
      : (definition as { handler: (ctx: ActionCtx, args: Record<string, unknown>) => unknown });
  const handler = def.handler;
  return rawAction({
    ...(def as object),
    handler: async (ctx: ActionCtx, args: Record<string, unknown>) => {
      try {
        return await handler(ctx, args);
      } catch (error) {
        const { message, hidden } = await publicFailure(ctx, error);
        if (!hidden) throw error;
        throw new ConvexError(message);
      }
    },
  } as Parameters<typeof rawAction>[0]);
}) as typeof rawAction;
