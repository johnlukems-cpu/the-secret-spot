import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";

export const metadata = { title: "Klanten" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("customers.view");
  const { q } = await searchParams;
  const supabase = await createClient();
  let query = supabase.from("customer_overview").select("*");
  if (q) { const t = q.replace(/[%,()]/g, ""); query = query.or(`full_name.ilike.%${t}%,whatsapp.ilike.%${t}%,email.ilike.%${t}%`); }
  const { data } = await query.order("last_order_at", { ascending: false, nullsFirst: false }).limit(200);
  const { data: messages } = await supabase.from("support_messages").select("id, name, contact, order_number, message, status, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(20);
  return (
    <div className="space-y-6">
      <PageHeader title="Klanten" />
      {(messages ?? []).length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Open klantvragen</h2>
          <ul className="divide-y text-sm">{(messages ?? []).map((m) => <li key={m.id} className="py-2"><span className="font-medium">{m.name}</span> · {m.contact}{m.order_number && ` · ${m.order_number}`} · <span className="text-taupe">{formatDate(m.created_at, true)}</span><p className="text-taupe">{m.message}</p></li>)}</ul>
        </div>
      )}
      <form className="flex gap-2"><input name="q" defaultValue={q} placeholder="Zoek naam, WhatsApp, e-mail" className="h-9 w-64 rounded-md border px-3 text-sm" /><Button size="sm">Zoeken</Button></form>
      <Table>
        <THead><TR><TH>Klant</TH><TH>Contact</TH><TH>Account</TH><TH className="text-right">Bestellingen</TH><TH className="text-right">Omzet (geleverd)</TH><TH className="text-right">Openstaand</TH><TH>Laatste bestelling</TH></TR></THead>
        <TBody>
          {(data ?? []).length === 0 && <EmptyRow cols={7}>Geen klanten gevonden.</EmptyRow>}
          {(data ?? []).map((c) => (
            <TR key={c.id}>
              <TD><Link href={`/admin/customers/${c.id}`} className="font-medium hover:underline">{c.full_name}</Link></TD>
              <TD className="text-xs">{c.whatsapp}<br />{c.email}</TD>
              <TD className="text-xs">{c.user_id ? "Geregistreerd" : "Gast"}</TD>
              <TD className="text-right">{c.order_count}</TD>
              <TD className="text-right tabular-nums">{formatSRD(c.lifetime_value)}</TD>
              <TD className="text-right tabular-nums">{formatSRD(c.open_balance)}</TD>
              <TD className="text-xs">{c.last_order_at ? formatDate(c.last_order_at) : "–"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
