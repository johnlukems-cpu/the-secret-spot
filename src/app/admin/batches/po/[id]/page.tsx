import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatSRD, type Currency } from "@/lib/money";
import { purchaseStatusLabel } from "@/lib/labels";
import { savePoInvoiceAction, savePoLineAction, setPoStatusAction, supplierPaymentAction } from "../../actions";

export default async function PoDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("purchasing.manage");
  const { id } = await params;
  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders").select("*, suppliers(id, name)").eq("id", id).maybeSingle();
  if (!po) notFound();
  const [{ data: lines }, { data: payments }, { data: variants }] = await Promise.all([
    supabase.from("purchase_order_items").select("*, product_variants(sku, size, color, products(title))").eq("purchase_order_id", id).order("created_at"),
    supabase.from("supplier_payments").select("*").eq("purchase_order_id", id).order("paid_at"),
    po.status === "draft" ? supabase.from("product_variants").select("id, sku").is("deleted_at", null).order("sku").limit(1000) : Promise.resolve({ data: [] }),
  ]);
  const cur = po.currency as Currency;
  const total = (lines ?? []).reduce((s, l) => s + Number(l.line_total), 0);
  const paidSrd = (payments ?? []).reduce((s, p) => s + Number(p.amount_srd), 0);
  const paidCur = (payments ?? []).filter((p) => p.currency === po.currency).reduce((s, p) => s + Number(p.amount), 0);
  const draft = po.status === "draft";
  const supplier = po.suppliers as { id: string; name: string };
  const next: Record<string, string[]> = { draft: ["ordered", "cancelled"], ordered: ["supplier_confirmed", "cancelled"], supplier_confirmed: ["cancelled"] };

  return (
    <div className="space-y-6">
      <PageHeader title={`Inkooporder ${po.po_number}`} description={`${supplier.name} · ${cur}${po.order_date ? ` · besteld ${formatDate(po.order_date)}` : ""}`}
        actions={<>
          <Badge variant="outline">{purchaseStatusLabel[po.status]}</Badge>
          <Button asChild size="sm" variant="outline"><a href={`/api/admin/po/${po.id}/pdf`}><FileDown /> PDF</a></Button>
          {(next[po.status] ?? []).map((s) => (
            <ActionForm key={s} action={setPoStatusAction} confirm={s === "cancelled" ? "Inkooporder annuleren?" : undefined}>
              <input type="hidden" name="poId" value={po.id} /><input type="hidden" name="status" value={s} />
              <SubmitButton size="sm" variant={s === "cancelled" ? "ghost" : "default"}>→ {purchaseStatusLabel[s]}</SubmitButton>
            </ActionForm>
          ))}
        </>} />
      {po.batch_id && <p className="text-sm">Hoort bij <Link href={`/admin/batches/${po.batch_id}`} className="underline">inkoopbatch</Link>. Zet de status op &ldquo;Besteld&rdquo; zodra u bij de leverancier heeft besteld: klanten krijgen dan bericht.</p>}
      <Table>
        <THead><TR><TH>Artikel</TH><TH className="text-right">Aantal</TH><TH className="text-right">Ontvangen</TH><TH className="text-right">Prijs/st</TH><TH className="text-right">Totaal</TH>{draft && <TH></TH>}</TR></THead>
        <TBody>
          {(lines ?? []).map((l) => {
            const v = l.product_variants as unknown as { sku: string; size: string | null; color: string | null; products: { title: string } };
            return (
              <TR key={l.id}>
                <TD>{v.products.title}<div className="text-xs text-taupe">{v.sku} · {[v.color, v.size].filter(Boolean).join(" / ")} {l.is_preorder ? "· pre-order" : "· voorraad"}</div></TD>
                {draft ? (
                  <TD colSpan={4}>
                    <ActionForm action={savePoLineAction} className="flex justify-end gap-2">
                      <input type="hidden" name="poId" value={po.id} /><input type="hidden" name="id" value={l.id} />
                      <input name="quantity" type="number" min={1} defaultValue={l.quantity} className="h-8 w-20 rounded border px-2 text-sm" aria-label="Aantal" />
                      <input name="unitCost" type="number" step="0.0001" min={0} defaultValue={l.unit_cost} className="h-8 w-28 rounded border px-2 text-sm" aria-label="Prijs" />
                      <SubmitButton size="sm" variant="outline">ok</SubmitButton>
                    </ActionForm>
                  </TD>
                ) : (
                  <>
                    <TD className="text-right">{l.quantity}</TD><TD className="text-right">{l.qty_received}</TD>
                    <TD className="text-right">{formatMoney(l.unit_cost, cur)}</TD><TD className="text-right">{formatMoney(l.line_total, cur)}</TD>
                  </>
                )}
              </TR>
            );
          })}
          <TR><TD className="font-semibold">Totaal</TD><TD colSpan={4} className="text-right font-semibold">{formatMoney(total, cur)}</TD></TR>
        </TBody>
      </Table>
      {draft && (
        <ActionForm action={savePoLineAction} className="flex flex-wrap items-end gap-2" reset>
          <input type="hidden" name="poId" value={po.id} />
          <select name="variantId" required className="h-9 rounded-md border px-2 text-sm"><option value="">Variant toevoegen…</option>{(variants ?? []).map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}</select>
          <input name="quantity" type="number" min={1} required placeholder="Aantal" className="h-9 w-24 rounded-md border px-2 text-sm" />
          <input name="unitCost" type="number" step="0.0001" min={0} required placeholder={`Prijs (${cur})`} className="h-9 w-28 rounded-md border px-2 text-sm" />
          <SubmitButton size="sm" variant="outline">Regel toevoegen</SubmitButton>
        </ActionForm>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Leverancier & factuur</CardTitle></CardHeader>
          <CardContent>
            <ActionForm action={savePoInvoiceAction} className="grid gap-2 text-sm sm:grid-cols-2">
              <input type="hidden" name="poId" value={po.id} />
              <label>Ref. leverancier<input name="supplier_reference" defaultValue={po.supplier_reference ?? ""} className="block h-9 w-full rounded-md border px-2" /></label>
              <label>Verwachte verzenddatum<input name="expected_ship_date" type="date" defaultValue={po.expected_ship_date ?? ""} className="block h-9 w-full rounded-md border px-2" /></label>
              <label>Factuurnummer<input name="supplier_invoice_ref" defaultValue={po.supplier_invoice_ref ?? ""} className="block h-9 w-full rounded-md border px-2" /></label>
              <label>Factuurbedrag ({cur})<input name="supplier_invoice_amount" type="number" step="0.01" defaultValue={po.supplier_invoice_amount ?? ""} className="block h-9 w-full rounded-md border px-2" /></label>
              <label>Geschatte verzendkosten ({cur})<input name="shipping_estimate" type="number" step="0.01" defaultValue={po.shipping_estimate} className="block h-9 w-full rounded-md border px-2" /></label>
              <label className="sm:col-span-2">Notities<textarea name="notes" defaultValue={po.notes ?? ""} className="block w-full rounded-md border p-2" rows={2} /></label>
              <div><SubmitButton size="sm" variant="outline">Opslaan</SubmitButton></div>
            </ActionForm>
            {po.supplier_confirmed_at && <p className="mt-2 text-xs text-taupe">Bevestigd door leverancier op {formatDate(po.supplier_confirmed_at, true)}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Betalingen aan leverancier</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="divide-y">
              {(payments ?? []).map((p) => <li key={p.id} className="flex justify-between py-1.5"><span>{formatDate(p.paid_at)} · {p.reference ?? "–"}</span><span>{formatMoney(p.amount, p.currency as Currency)} (= {formatSRD(p.amount_srd)} @ {Number(p.exchange_rate)})</span></li>)}
            </ul>
            <p>Betaald: {formatMoney(paidCur, cur)} / {formatMoney(po.supplier_invoice_amount ?? total, cur)} · {formatSRD(paidSrd)}</p>
            <ActionForm action={supplierPaymentAction} className="grid gap-2 sm:grid-cols-3" reset>
              <input type="hidden" name="poId" value={po.id} /><input type="hidden" name="supplierId" value={supplier.id} />
              <input name="amount" type="number" step="0.01" required placeholder="Bedrag" className="h-9 rounded-md border px-2" />
              <select name="currency" defaultValue={po.currency} className="h-9 rounded-md border px-2">{["CNY", "USD", "EUR", "SRD"].map((c) => <option key={c}>{c}</option>)}</select>
              <input name="exchangeRate" type="number" step="0.00000001" required placeholder="Koers → SRD" className="h-9 rounded-md border px-2" />
              <input name="paidAt" type="date" required className="h-9 rounded-md border px-2" />
              <input name="method" placeholder="Methode" className="h-9 rounded-md border px-2" />
              <input name="reference" placeholder="Referentie" className="h-9 rounded-md border px-2" />
              <div><SubmitButton size="sm" variant="outline">Registreren</SubmitButton></div>
            </ActionForm>
            <p className="text-xs text-taupe">Gebruik de werkelijke koers van de betaling (bank / wisselkantoor).</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
