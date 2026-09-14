import { query } from "./_generated/server";
import { getCurrentUser, getPrimaryWorkspace } from "./lib/auth";

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const workspace = await getPrimaryWorkspace(ctx, user._id);
    if (!workspace) return null;

    const [campaigns, replies, leads, generations] = await Promise.all([
      ctx.db
        .query("campaigns")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect(),
      ctx.db
        .query("replies")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect(),
      ctx.db
        .query("leads")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect(),
      ctx.db
        .query("generations")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect(),
    ]);

    return {
      credits: workspace.credits,
      plan: workspace.plan,
      activeCampaigns: campaigns.filter((c) => c.status === "active").length,
      totalCampaigns: campaigns.length,
      replies: replies.length,
      unreadReplies: replies.filter((r) => !r.read).length,
      leads: leads.length,
      generations: generations.length,
    };
  },
});
