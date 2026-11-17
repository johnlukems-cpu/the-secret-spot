import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { roleLabel } from "@/lib/labels";
import { inviteStaffAction, setRoleAction } from "./actions";

export const metadata = { title: "Gebruikers & rechten" };
const staffRoles = ["super_admin", "admin", "finance_manager", "inventory_manager", "order_manager", "purchasing_manager", "delivery_manager"];

export default async function UsersPage() {
  const session = await requirePermission("users.manage");
  const supabase = await createClient();
  const [{ data: staff }, { data: matrix }, { data: perms }] = await Promise.all([
    supabase.rpc("staff_directory"),
    supabase.from("role_permissions").select("role, permission_code"),
    supabase.from("permissions").select("code, description").order("code"),
  ]);
  const list = (staff ?? []) as { user_id: string; full_name: string | null; email: string | null; roles: string[] }[];
  return (
    <div className="space-y-6">
      <PageHeader title="Gebruikers & rechten" description="Rechten worden in de database afgedwongen (Row Level Security + functies), niet alleen in de interface. Alleen een Super Administrator kan (super)admins aanstellen." />
      <Card>
        <CardHeader><CardTitle>Medewerker uitnodigen</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={inviteStaffAction} className="flex flex-wrap items-end gap-2 text-sm" reset>
            <input name="fullName" required placeholder="Naam" className="h-9 w-44 rounded-md border px-2" />
            <input name="email" type="email" required placeholder="E-mail" className="h-9 w-56 rounded-md border px-2" />
            <select name="role" className="h-9 rounded-md border px-2">{staffRoles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}</select>
            <SubmitButton size="sm">Uitnodigen</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {list.map((u) => (
          <div key={u.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3 text-sm">
            <div><p className="font-medium">{u.full_name || u.email}{u.user_id === session.userId && " (u)"}</p><p className="text-xs text-taupe">{u.email}</p></div>
            <div className="flex flex-wrap gap-1">
              {staffRoles.map((r) => {
                const has = u.roles.includes(r);
                return (
                  <ActionForm key={r} action={setRoleAction} confirm={`${has ? "Intrekken" : "Toekennen"}: ${roleLabel[r]}?`}>
                    <input type="hidden" name="userId" value={u.user_id} /><input type="hidden" name="role" value={r} /><input type="hidden" name="grant" value={has ? "0" : "1"} />
                    <button className={`rounded-full border px-2 py-0.5 text-xs ${has ? "border-charcoal bg-charcoal text-cream" : "text-taupe"}`}>{roleLabel[r]}</button>
                  </ActionForm>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Rechtenmatrix</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="text-xs">
            <thead><tr><th className="p-1 text-left">Recht</th>{staffRoles.slice(1).map((r) => <th key={r} className="p-1">{roleLabel[r]}</th>)}</tr></thead>
            <tbody>
              {(perms ?? []).map((p) => (
                <tr key={p.code} className="border-t"><td className="p-1" title={p.description}>{p.code}</td>
                  {staffRoles.slice(1).map((r) => <td key={r} className="p-1 text-center">{(matrix ?? []).some((m) => m.role === r && m.permission_code === p.code) ? "●" : ""}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-taupe">Super Administrator heeft alle rechten.</p>
        </CardContent>
      </Card>
    </div>
  );
}
