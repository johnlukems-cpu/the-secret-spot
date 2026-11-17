import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, type Currency } from "@/lib/money";
import { cancelBatchAction, createPoFromBatchAction } from "../actions";

export default async function BatchDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("purchasing.manage");
  const { id } = await params;
  const supabase = await createClient();
  const { data: b } = await supabase.from("purchase_batches").select("*, suppliers(name)").eq("id", id).maybeSingle();
  if (!b) notFound();
  const [{ data: items }, { data: pos }] = await Promise.all([
    supabase.from("purchase_batch_items").select("id, quantity, unit_cost, order_items(title, sku, size, color, orders(id, order_number, customer_name))").eq("batch_id", id),
    supabase.from("purchase_orders").select("id, po_number, status").eq("batch_id", id),
  ]);
  const hasPo = (pos ?? []).some((p) => p.status !== "cancelled");
  return (
    <div className="space-y-6">
      <PageHeader title={`Batch ${b.batch_number}`} description={`${(b.suppliers as { name: string } | null)?.name} · week van ${formatDate(b.week_start)} · verwacht ${formatMoney(b.expected_cost, b.currency as Currency)}`}
        actions={<>
          <Badge variant="outline">{b.status}</Badge>
          {!hasPo && ["open", "purchasing"].includes(b.status) && <ActionForm action={createPoFromBatchAction}><input type="hidden" name="batchId" value={id} /><SubmitButton size="sm">Inkooporder genereren</SubmitButton></ActionForm>}
          {!hasPo && b.status !== "cancelled" && <ActionForm action={cancelBatchAction} confirm="Batch annuleren?"><input type="hidden" name="batchId" value={id} /><SubmitButton size="sm" variant="outline">Annuleren</SubmitButton></ActionForm>}
        </>} />
      {(pos ?? []).map((p) => <p key={p.id} className="text-sm">Inkooporder: <Link href={`/admin/batches/po/${p.id}`} className="underline">{p.po_number}</Link> ({p.status})</p>)}
      <Table>
        <THead><TR><TH>Klantbestelling</TH><TH>Artikel</TH><TH className="text-right">Stuks</TH><TH className="text-right">Prijs/st</TH></TR></THead>
        <TBody>
          {(items ?? []).map((i) => {
            const oi = i.order_items as unknown as { title: string; sku: string; size: string | null; color: string | null; orders: { id: string; order_number: string; customer_name: string } };
            return (
              <TR key={i.id}>
                <TD><Link href={`/admin/orders/${oi.orders.id}`} className="underline">{oi.orders.order_number}</Link><div className="text-xs text-taupe">{oi.orders.customer_name}</div></TD>
                <TD>{oi.title}<div className="text-xs text-taupe">{oi.sku} · {[oi.color, oi.size].filter(Boolean).join(" / ")}</div></TD>
                <TD className="text-right">{i.quantity}</TD>
                <TD className="text-right">{i.unit_cost != null ? formatMoney(i.unit_cost, b.currency as Currency) : "onbekend"}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
