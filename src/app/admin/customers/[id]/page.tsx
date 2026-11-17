import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { orderStatusLabel, statusVariant } from "@/lib/labels";
import { whatsappLink } from "@/lib/whatsapp";

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customers.view");
  const { id } = await params;
  const supabase = await createClient();
  const { data: c } = await supabase.from("customer_overview").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: orders }, { data: addresses }] = await Promise.all([
    supabase.from("orders").select("id, order_number, status, total, balance_due, created_at").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("customer_addresses").select("label, address_line, delivery_zones(name)").eq("customer_id", id),
  ]);
  const wa = whatsappLink(c.whatsapp);
  return (
    <div className="space-y-6">
      <PageHeader title={c.full_name} description={`${c.whatsapp}${c.email ? ` · ${c.email}` : ""} · ${c.user_id ? "geregistreerd account" : "gast"}`} actions={wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="text-sm underline">WhatsApp</a>} />
      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-lg border bg-white p-4">Bestellingen<br /><span className="text-xl font-semibold">{c.order_count}</span></div>
        <div className="rounded-lg border bg-white p-4">Omzet geleverd<br /><span className="text-xl font-semibold">{formatSRD(c.lifetime_value)}</span></div>
        <div className="rounded-lg border bg-white p-4">Openstaand<br /><span className="text-xl font-semibold">{formatSRD(c.open_balance)}</span></div>
      </div>
      {(addresses ?? []).length > 0 && <div className="text-sm">{(addresses ?? []).map((a, i) => <p key={i}>{a.label ?? "Adres"}: {a.address_line}, {(a.delivery_zones as unknown as { name: string } | null)?.name}</p>)}</div>}
      <Table>
        <THead><TR><TH>Bestelling</TH><TH>Datum</TH><TH>Status</TH><TH className="text-right">Totaal</TH><TH className="text-right">Openstaand</TH></TR></THead>
        <TBody>
          {(orders ?? []).map((o) => (
            <TR key={o.id}><TD><Link href={`/admin/orders/${o.id}`} className="underline">{o.order_number}</Link></TD><TD>{formatDate(o.created_at)}</TD>
              <TD><Badge variant={statusVariant(o.status)}>{orderStatusLabel[o.status]}</Badge></TD><TD className="text-right">{formatSRD(o.total)}</TD><TD className="text-right">{formatSRD(o.balance_due)}</TD></TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
