import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export type Permission =
  | "dashboard.view" | "products.manage" | "categories.manage" | "inventory.manage" | "orders.view"
  | "orders.manage" | "quotations.manage" | "payments.view" | "payments.verify" | "payments.record"
  | "payments.refund" | "customers.view" | "customers.manage" | "preorders.manage" | "suppliers.manage"
  | "supplier_costs.view" | "purchasing.manage" | "shipments.manage" | "deliveries.view" | "deliveries.manage"
  | "pricing.manage" | "expenses.manage" | "finance.view" | "reports.view" | "promotions.manage"
  | "content.manage" | "notifications.manage" | "users.manage" | "settings.manage" | "settings.bank" | "audit.view";

export interface SessionContext {
  userId: string;
  email: string | null;
  roles: string[];
  permissions: Set<string>;
  isStaff: boolean;
}

/** Current user + roles + effective permissions (cached per request). */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: roles }, { data: perms }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.rpc("my_permissions"),
  ]);
  const roleList = (roles ?? []).map((r: { role: string }) => r.role);
  return {
    userId: user.id,
    email: user.email ?? null,
    roles: roleList,
    permissions: new Set<string>((perms as string[] | null) ?? []),
    isStaff: roleList.some((r) => r !== "customer"),
  };
});

export function can(session: SessionContext | null, perm: Permission): boolean {
  return Boolean(session && (session.roles.includes("super_admin") || session.permissions.has(perm)));
}

/** Guard for admin pages. The database enforces the same permission again. */
export async function requirePermission(perm: Permission): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");
  if (!can(session, perm)) redirect("/admin/geen-toegang");
  return session;
}

export async function requireStaff(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");
  if (!session.isStaff) redirect("/account");
  return session;
}

export async function requireUser(next = "/account"): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  return session;
}
