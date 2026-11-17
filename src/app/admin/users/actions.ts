"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import type { ActionResult } from "../action-types";

const roles = ["super_admin", "admin", "finance_manager", "inventory_manager", "order_manager", "purchasing_manager", "delivery_manager"] as const;

export async function setRoleAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ userId: z.string().uuid(), role: z.enum(roles), grant: z.enum(["1", "0"]) }), fd);
  if (!f.ok) return f;
  return adminAction("users.manage", async ({ supabase }) => {
    // assign_role enforces users.manage and blocks privilege escalation in the database
    check(await supabase.rpc("assign_role", { _user_id: f.data.userId, _role: f.data.role, _grant: f.data.grant === "1" }));
    return { ok: true, message: f.data.grant === "1" ? "Rol toegekend" : "Rol ingetrokken" };
  }, ["/admin/users"]);
}

export async function inviteStaffAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ email: z.string().trim().email(), fullName: z.string().trim().min(2).max(120), role: z.enum(roles) }), fd);
  if (!f.ok) return f;
  return adminAction("users.manage", async ({ supabase }) => {
    const admin = createAdminClient();
    // Look up an existing account first; otherwise send a Supabase invitation e-mail.
    const { data: existing } = await admin.from("profiles").select("id").ilike("email", f.data.email).maybeSingle();
    let userId = existing?.id as string | undefined;
    if (!userId) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(f.data.email, { data: { full_name: f.data.fullName }, redirectTo: `${publicEnv.siteUrl}/auth/callback?next=/auth/nieuw-wachtwoord` });
      if (error) return { ok: false, error: `Uitnodigen mislukt: ${error.message}` };
      userId = data.user.id;
    }
    check(await supabase.rpc("assign_role", { _user_id: userId, _role: f.data.role, _grant: true }));
    return { ok: true, message: existing ? "Bestaande gebruiker heeft de rol gekregen" : "Uitnodiging verstuurd en rol toegekend" };
  }, ["/admin/users"]);
}
