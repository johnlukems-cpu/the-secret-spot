import { PageHeader } from "@/components/admin/page-header";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/money";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; id?: string }> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("audit_logs").select("*");
  if (sp.entity) q = q.eq("entity_type", sp.entity);
  if (sp.id) q = q.eq("entity_id", sp.id);
  const [{ data }, { data: staff }] = await Promise.all([q.order("occurred_at", { ascending: false }).limit(200), supabase.rpc("staff_directory")]);
  const names = new Map(((staff ?? []) as { user_id: string; full_name: string | null; email: string | null }[]).map((s) => [s.user_id, s.full_name || s.email]));
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" description="Onveranderbaar logboek van wijzigingen aan bestellingen, betalingen, prijzen, instellingen, rollen en meer. Betalingshistorie staat daarnaast per betaling vast." />
      <form className="flex flex-wrap gap-2">
        <select name="entity" defaultValue={sp.entity ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Alle</option>{["orders", "products", "business_settings", "bank_accounts", "user_roles", "refunds", "exchange_rates", "import_costs", "shipments", "purchase_orders", "deliveries", "expenses", "supplier_payments", "purchase_batches"].map((e) => <option key={e}>{e}</option>)}
        </select>
        <input name="id" defaultValue={sp.id} placeholder="Entity ID" className="h-9 w-64 rounded-md border px-2 text-sm" />
        <Button size="sm">Filter</Button>
      </form>
      <Table>
        <THead><TR><TH>Tijd</TH><TH>Gebruiker</TH><TH>Actie</TH><TH>Object</TH><TH>Details</TH></TR></THead>
        <TBody>
          {(data ?? []).length === 0 && <EmptyRow cols={5}>Geen regels.</EmptyRow>}
          {(data ?? []).map((a) => (
            <TR key={a.id}>
              <TD className="whitespace-nowrap text-xs">{formatDate(a.occurred_at, true)}</TD>
              <TD className="text-xs">{a.actor_id ? names.get(a.actor_id) ?? a.actor_id.slice(0, 8) : "systeem"}</TD>
              <TD>{a.action}</TD>
              <TD className="text-xs">{a.entity_type}<div className="text-taupe">{a.entity_id?.slice(0, 36)}</div></TD>
              <TD className="max-w-md text-xs">
                {a.note && <p>{a.note}</p>}
                <details><summary className="cursor-pointer text-taupe">data</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px]">{JSON.stringify({ old: a.old_data, new: a.new_data }, null, 1)}</pre></details>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
