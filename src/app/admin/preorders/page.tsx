import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { fulfilmentLabel, orderStatusLabel, statusVariant } from "@/lib/labels";

export const metadata = { title: "Pre-orders" };

export default async function PreordersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requirePermission("preorders.manage");
  const { status } = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("order_items").select("id, title, sku, size, color, quantity, qty_allocated, fulfilment_status, estimated_ready_from, estimated_ready_to, line_total, orders!inner(id, order_number, customer_name, status, amount_verified, deposit_required, balance_due, created_at)")
    .eq("sales_type", "preorder").not("orders.status", "in", "(cancelled,expired,completed)");
  if (status) q = q.eq("fulfilment_status", status);
  const { data } = await q.order("created_at", { ascending: false }).limit(300);
  const counts = (data ?? []).reduce<Record<string, number>>((acc, r) => { acc[r.fulfilment_status] = (acc[r.fulfilment_status] ?? 0) + r.quantity; return acc; }, {});
  return (
    <div className="space-y-4">
      <PageHeader title="Pre-orders" description="Pre-order regels in de keten: aanbetaling → inkoop → verzending → ontvangst → toewijzing → levering." actions={<Button asChild size="sm"><Link href="/admin/purchasing">Naar inkooprapport</Link></Button>} />
      <div className="flex flex-wrap gap-2 text-xs">
        <Link href="/admin/preorders" className="rounded-full border px-3 py-1">Alle</Link>
        {["pending", "awaiting_purchase", "purchased", "in_transit", "received", "allocated"].map((s) => (
          <Link key={s} href={`/admin/preorders?status=${s}`} className={`rounded-full border px-3 py-1 ${status === s ? "bg-charcoal text-cream" : ""}`}>{fulfilmentLabel[s]} {counts[s] ? `(${counts[s]})` : ""}</Link>
        ))}
      </div>
      <Table>
        <THead><TR><TH>Bestelling</TH><TH>Artikel</TH><TH className="text-right">Aantal</TH><TH>Status regel</TH><TH>Status bestelling</TH><TH>Schatting</TH><TH className="text-right">Aanbetaald</TH><TH className="text-right">Openstaand</TH></TR></THead>
        <TBody>
          {(data ?? []).length === 0 && <EmptyRow cols={8}>Geen pre-order regels.</EmptyRow>}
          {(data ?? []).map((r) => {
            const o = r.orders as unknown as { id: string; order_number: string; customer_name: string; status: string; amount_verified: string; deposit_required: string; balance_due: string };
            return (
              <TR key={r.id}>
                <TD><Link href={`/admin/orders/${o.id}`} className="underline">{o.order_number}</Link><div className="text-xs text-taupe">{o.customer_name}</div></TD>
                <TD>{r.title}<div className="text-xs text-taupe">{r.sku} · {[r.color, r.size].filter(Boolean).join(" / ")}</div></TD>
                <TD className="text-right">{r.qty_allocated}/{r.quantity}</TD>
                <TD><Badge variant="outline">{fulfilmentLabel[r.fulfilment_status]}</Badge></TD>
                <TD><Badge variant={statusVariant(o.status)}>{orderStatusLabel[o.status]}</Badge></TD>
                <TD className="text-xs">{r.estimated_ready_from ? `${formatDate(r.estimated_ready_from)} – ${formatDate(r.estimated_ready_to)}` : "–"}</TD>
                <TD className="text-right tabular-nums">{formatSRD(o.amount_verified)}</TD>
                <TD className="text-right tabular-nums">{formatSRD(o.balance_due)}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
