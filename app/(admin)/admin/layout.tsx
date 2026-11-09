import { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { isConfigured } from "@/lib/runtime";
import { AppShell } from "@/components/shell/app-shell";
import { AdminGate } from "@/components/admin-gate";

/**
 * Server-side admin gate: non-admins get a 404 before any admin markup is
 * sent. The one exception is a platform with no admin at all yet, where the
 * client gate offers the first signed-in user the superadmin claim. (Every
 * admin Convex function checks the role independently.)
 */
async function serverAdminCheck(): Promise<void> {
  if (!isConfigured) {
    // Setup mode previews everything in dev; production must never fall open.
    if (process.env.NODE_ENV === "production") notFound();
    return;
  }
  const { userId, getToken } = await auth();
  if (!userId) notFound();
  const token = await getToken({ template: "convex" });
  if (!token) notFound();
  const me = await fetchQuery(api.users.me, {}, { token });
  if (me?.adminRole) return; // users.me strips the role from locked accounts.
  const hasAnyAdmin = await fetchQuery(api.admin.hasAnyAdmin, {}, { token });
  if (hasAnyAdmin) notFound();
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await serverAdminCheck();
  return (
    <AppShell variant="admin">
      <AdminGate>{children}</AdminGate>
    </AppShell>
  );
}
