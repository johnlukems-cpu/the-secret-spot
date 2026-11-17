import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, type Currency } from "@/lib/money";
import { purchaseStatusLabel } from "@/lib/labels";
import { createManualPoAction } from "./actions";

export const metadata = { title: "Inkoopbatches & PO's" };

export default async function BatchesPage() {
  await requirePermission("purchasing.manage");
  const supabase = await createClient();
  const [{ data: batches }, { data: pos }, { data: suppliers }] = await Promise.all([
    supabase.from("purchase_batches").select("id, batch_number, week_start, purchasing_date, status, expected_cost, actual_cost, currency, suppliers(name), purchase_batch_items(quantity)").order("created_at", { ascending: false }).limit(100),
    supabase.from("purchase_orders").select("id, po_number, status, currency, order_date, supplier_invoice_amount, batch_id, suppliers(name), purchase_order_items(line_total, quantity, qty_received)").order("created_at", { ascending: false }).limit(100),
    supabase.from("suppliers").select("id, name, currency").is("deleted_at", null).order("name"),
  ]);
  return (
    <div className="space-y-8">
      <PageHeader title="Inkoopbatches & inkooporders" />
      <section>
        <h2 className="mb-2 text-sm font-semibold">Inkoopbatches</h2>
        <Table>
          <THead><TR><TH>Batch</TH><TH>Leverancier</TH><TH>Week</TH><TH>Status</TH><TH className="text-right">Stuks</TH><TH className="text-right">Verwacht</TH><TH className="text-right">Werkelijk</TH></TR></THead>
          <TBody>
            {(batches ?? []).length === 0 && <EmptyRow cols={7}>Nog geen batches. Maak er een aan vanuit het inkooprapport.</EmptyRow>}
            {(batches ?? []).map((b) => (
              <TR key={b.id}>
                <TD><Link href={`/admin/batches/${b.id}`} className="font-medium underline">{b.batch_number}</Link></TD>
                <TD>{(b.suppliers as unknown as { name: string } | null)?.name}</TD><TD>{formatDate(b.week_start)}</TD>
                <TD><Badge variant="outline">{b.status}</Badge></TD>
                <TD className="text-right">{(b.purchase_batch_items ?? []).reduce((s: number, i: { quantity: number }) => s + i.quantity, 0)}</TD>
                <TD className="text-right">{formatMoney(b.expected_cost, b.currency as Currency)}</TD>
                <TD className="text-right">{b.actual_cost != null ? formatMoney(b.actual_cost, b.currency as Currency) : "–"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </section>
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Inkooporders</h2>
          <ActionForm action={createManualPoAction} className="flex flex-wrap gap-2">
            <select name="supplierId" required className="h-9 rounded-md border px-2 text-sm"><option value="">Leverancier…</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <select name="currency" className="h-9 rounded-md border px-2 text-sm">{["CNY", "USD", "EUR", "SRD"].map((c) => <option key={c}>{c}</option>)}</select>
            <SubmitButton size="sm" variant="outline">Losse PO (voorraadinkoop)</SubmitButton>
          </ActionForm>
        </div>
        <Table>
          <THead><TR><TH>PO</TH><TH>Leverancier</TH><TH>Datum</TH><TH>Status</TH><TH className="text-right">Ontvangen</TH><TH className="text-right">Waarde</TH><TH className="text-right">Factuur</TH></TR></THead>
          <TBody>
            {(pos ?? []).length === 0 && <EmptyRow cols={7}>Nog geen inkooporders.</EmptyRow>}
            {(pos ?? []).map((p) => {
              const items = (p.purchase_order_items ?? []) as { line_total: string; quantity: number; qty_received: number }[];
              return (
                <TR key={p.id}>
                  <TD><Link href={`/admin/batches/po/${p.id}`} className="font-medium underline">{p.po_number}</Link>{p.batch_id && <div className="text-xs text-taupe">uit batch</div>}</TD>
                  <TD>{(p.suppliers as unknown as { name: string } | null)?.name}</TD><TD>{p.order_date ? formatDate(p.order_date) : "–"}</TD>
                  <TD><Badge variant="outline">{purchaseStatusLabel[p.status]}</Badge></TD>
                  <TD className="text-right">{items.reduce((s, i) => s + i.qty_received, 0)}/{items.reduce((s, i) => s + i.quantity, 0)}</TD>
                  <TD className="text-right">{formatMoney(items.reduce((s, i) => s + Number(i.line_total), 0), p.currency as Currency)}</TD>
                  <TD className="text-right">{p.supplier_invoice_amount != null ? formatMoney(p.supplier_invoice_amount, p.currency as Currency) : "–"}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </section>
    </div>
  );
}
