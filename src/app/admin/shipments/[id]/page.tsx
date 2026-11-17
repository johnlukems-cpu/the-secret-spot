import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatSRD, type Currency } from "@/lib/money";
import { shipmentStatusLabel, statusVariant } from "@/lib/labels";
import { addImportCostAction, addShipmentLineAction, allocateCostsAction, deleteImportCostAction, receiveShipmentAction, removeShipmentLineAction, saveShipmentAction, setShipmentStatusAction, updateShipmentLineAction } from "../actions";

const flow = ["preparing", "purchased", "supplier_processing", "ready_for_shipment", "shipped", "in_transit", "customs_clearance", "arrived", "received", "closed"];
const costLabel: Record<string, string> = { shipping: "Vracht", customs_duty: "Invoerrechten", import_tax: "Importbelasting", clearance: "Inklaring", local_transport: "Lokaal transport", packaging: "Verpakking", other: "Overig" };

export default async function ShipmentDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("shipments.manage");
  const { id } = await params;
  const supabase = await createClient();
  const { data: s } = await supabase.from("shipments").select("*").eq("id", id).maybeSingle();
  if (!s) notFound();
  const [{ data: lines }, { data: costs }, { data: openPoItems }, { data: locations }] = await Promise.all([
    supabase.from("shipment_items").select("*, product_variants(sku, size, color, products(title, base_price)), purchase_order_items(purchase_orders(po_number, currency), unit_cost)").eq("shipment_id", id).order("created_at"),
    supabase.from("import_costs").select("*").eq("shipment_id", id).order("created_at"),
    supabase.from("purchase_order_items").select("id, quantity, product_variants(sku), purchase_orders!inner(po_number, status), shipment_items(quantity_shipped)").in("purchase_orders.status", ["ordered", "supplier_confirmed", "partially_received"]).limit(500),
    supabase.from("storage_locations").select("id, name, is_default").eq("is_active", true).order("is_default", { ascending: false }),
  ]);
  const available = (openPoItems ?? []).map((p) => ({ ...p, remaining: p.quantity - ((p.shipment_items ?? []) as { quantity_shipped: number }[]).reduce((a, x) => a + x.quantity_shipped, 0) })).filter((p) => p.remaining > 0);
  const actualCosts = (costs ?? []).filter((c) => !c.is_estimate).reduce((a, c) => a + Number(c.amount_srd), 0);
  const estCosts = (costs ?? []).filter((c) => c.is_estimate).reduce((a, c) => a + Number(c.amount_srd), 0);
  const goods = (lines ?? []).reduce((a, l) => a + Number(l.goods_value_srd ?? 0), 0);
  const landedTotal = (lines ?? []).reduce((a, l) => a + Number(l.landed_unit_cost_srd ?? 0) * l.quantity_shipped, 0);
  const retail = (lines ?? []).reduce((a, l) => a + l.quantity_shipped * Number((l.product_variants as unknown as { products: { base_price: string } }).products.base_price), 0);
  const idx = flow.indexOf(s.status);
  const openReceipt = (lines ?? []).some((l) => l.quantity_received + l.quantity_damaged < l.quantity_shipped);
  const locked = ["received", "closed"].includes(s.status);

  return (
    <div className="space-y-6">
      <PageHeader title={`Zending ${s.shipment_number}`} description={`${s.shipping_method ?? ""} ${s.shipping_agent ? `· ${s.shipping_agent}` : ""} ${s.tracking_number ? `· track ${s.tracking_number}` : ""}`}
        actions={<>
          <Badge variant={statusVariant(s.status)}>{shipmentStatusLabel[s.status]}</Badge>
          {flow.slice(idx + 1, idx + 3).filter((st) => st !== "received").map((st) => (
            <ActionForm key={st} action={setShipmentStatusAction}><input type="hidden" name="shipmentId" value={id} /><input type="hidden" name="status" value={st} /><SubmitButton size="sm" variant="outline">→ {shipmentStatusLabel[st]}</SubmitButton></ActionForm>
          ))}
        </>} />

      <div className="grid gap-3 sm:grid-cols-4 text-sm">
        <div className="rounded-lg border bg-white p-4">Goederenwaarde<br /><b>{formatSRD(goods)}</b></div>
        <div className="rounded-lg border bg-white p-4">Importkosten<br /><b>{formatSRD(actualCosts)}</b> <span className="text-xs text-taupe">werkelijk</span>{estCosts > 0 && <div className="text-xs text-taupe">schatting: {formatSRD(estCosts)}</div>}</div>
        <div className="rounded-lg border bg-white p-4">Landed cost totaal<br /><b>{landedTotal ? formatSRD(landedTotal) : "nog niet toegerekend"}</b></div>
        <div className="rounded-lg border bg-white p-4">Verkoopwaarde (lijstprijs)<br /><b>{formatSRD(retail)}</b>{landedTotal > 0 && <div className="text-xs text-taupe">bruto marge {(((retail - landedTotal) / retail) * 100).toFixed(1)}%</div>}</div>
      </div>

      <Card>
        <CardHeader><CardTitle>Regels</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <THead><TR><TH>Artikel</TH><TH>PO</TH><TH className="text-right">Verzonden</TH><TH className="text-right">Ontv./besch.</TH><TH>Gewicht / volume / handm.</TH><TH className="text-right">Goederen</TH><TH className="text-right">Toegerekend</TH><TH className="text-right">Landed/st</TH><TH></TH></TR></THead>
            <TBody>
              {(lines ?? []).length === 0 && <EmptyRow cols={9}>Nog geen regels. Voeg PO-regels toe.</EmptyRow>}
              {(lines ?? []).map((l) => {
                const v = l.product_variants as unknown as { sku: string; size: string | null; color: string | null; products: { title: string } };
                const po = (l.purchase_order_items as unknown as { purchase_orders: { po_number: string; currency: Currency }; unit_cost: string });
                return (
                  <TR key={l.id}>
                    <TD>{v.products.title}<div className="text-xs text-taupe">{v.sku}</div></TD>
                    <TD className="text-xs">{po.purchase_orders.po_number}<div className="text-taupe">{formatMoney(po.unit_cost, po.purchase_orders.currency)}/st</div></TD>
                    <TD className="text-right">{l.quantity_shipped}</TD>
                    <TD className="text-right">{l.quantity_received}/{l.quantity_damaged}</TD>
                    <TD>
                      <ActionForm action={updateShipmentLineAction} className="flex gap-1">
                        <input type="hidden" name="shipmentId" value={id} /><input type="hidden" name="id" value={l.id} />
                        <input name="weight" type="number" step="0.001" defaultValue={l.weight_kg ?? ""} placeholder="kg" className="h-8 w-16 rounded border px-1 text-xs" aria-label="Gewicht" />
                        <input name="volume" type="number" step="0.000001" defaultValue={l.volume_m3 ?? ""} placeholder="m³" className="h-8 w-16 rounded border px-1 text-xs" aria-label="Volume" />
                        <input name="manual" type="number" step="0.000001" defaultValue={l.manual_share ?? ""} placeholder="aandeel" className="h-8 w-16 rounded border px-1 text-xs" aria-label="Handmatig aandeel" />
                        <button className="text-xs underline">ok</button>
                      </ActionForm>
                    </TD>
                    <TD className="text-right tabular-nums">{l.goods_value_srd != null ? formatSRD(l.goods_value_srd) : "–"}</TD>
                    <TD className="text-right tabular-nums">{l.allocated_cost_srd != null ? formatSRD(l.allocated_cost_srd) : "–"}</TD>
                    <TD className="text-right tabular-nums">{l.landed_unit_cost_srd != null ? formatSRD(l.landed_unit_cost_srd) : "–"}</TD>
                    <TD>{l.quantity_received + l.quantity_damaged === 0 && <ActionForm action={removeShipmentLineAction}><input type="hidden" name="shipmentId" value={id} /><input type="hidden" name="id" value={l.id} /><button className="text-xs underline">x</button></ActionForm>}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {!locked && (
            <ActionForm action={addShipmentLineAction} className="flex flex-wrap items-end gap-2 text-sm" reset>
              <input type="hidden" name="shipmentId" value={id} />
              <select name="poItemId" required className="h-9 rounded-md border px-2"><option value="">PO-regel toevoegen…</option>
                {available.map((p) => <option key={p.id} value={p.id}>{(p.purchase_orders as unknown as { po_number: string }).po_number} · {(p.product_variants as unknown as { sku: string }).sku} · nog {p.remaining}</option>)}
              </select>
              <input name="quantity" type="number" min={1} required placeholder="Aantal" className="h-9 w-24 rounded-md border px-2" />
              <input name="weight" type="number" step="0.001" placeholder="Gewicht kg" className="h-9 w-28 rounded-md border px-2" />
              <input name="volume" type="number" step="0.000001" placeholder="Volume m³" className="h-9 w-28 rounded-md border px-2" />
              <SubmitButton size="sm" variant="outline">Toevoegen</SubmitButton>
            </ActionForm>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Importkosten</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="divide-y">
              {(costs ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{costLabel[c.cost_type]} {c.description && `· ${c.description}`} {c.is_estimate && <Badge variant="warning">schatting</Badge>} {c.invoice_ref && <span className="text-xs text-taupe">fact. {c.invoice_ref}</span>}</span>
                  <span className="flex items-center gap-2">{formatMoney(c.amount, c.currency as Currency)} = {formatSRD(c.amount_srd)}
                    <ActionForm action={deleteImportCostAction} confirm="Kostenregel verwijderen?"><input type="hidden" name="shipmentId" value={id} /><input type="hidden" name="id" value={c.id} /><button className="text-xs underline">x</button></ActionForm></span>
                </li>
              ))}
            </ul>
            <ActionForm action={addImportCostAction} className="grid gap-2 sm:grid-cols-3" reset>
              <input type="hidden" name="shipmentId" value={id} />
              <select name="cost_type" className="h-9 rounded-md border px-2">{Object.entries(costLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input name="amount" type="number" step="0.01" min="0" required placeholder="Bedrag" className="h-9 rounded-md border px-2" />
              <select name="currency" className="h-9 rounded-md border px-2">{["SRD", "USD", "EUR", "CNY"].map((c) => <option key={c}>{c}</option>)}</select>
              <input name="exchange_rate" type="number" step="0.00000001" required defaultValue="1" placeholder="Koers → SRD" className="h-9 rounded-md border px-2" />
              <input name="invoice_ref" placeholder="Factuurnr." className="h-9 rounded-md border px-2" />
              <input name="description" placeholder="Omschrijving" className="h-9 rounded-md border px-2" />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="is_estimate" /> schatting (nog geen factuur)</label>
              <label className="text-xs">Betaald op<input name="paid_at" type="date" className="block h-9 rounded-md border px-2" /></label>
              <div><SubmitButton size="sm" variant="outline">Toevoegen</SubmitButton></div>
            </ActionForm>
            <div className="border-t pt-3">
              <ActionForm action={allocateCostsAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="shipmentId" value={id} />
                <select name="method" defaultValue={s.allocation_method} className="h-9 rounded-md border px-2">
                  <option value="value">Naar goederenwaarde</option><option value="weight">Naar gewicht</option><option value="volume">Naar volume</option><option value="units">Per stuk</option><option value="manual">Handmatig aandeel</option>
                </select>
                <SubmitButton size="sm">Kosten toerekenen</SubmitButton>
              </ActionForm>
              <p className="mt-2 text-xs text-taupe">Werkelijke kosten gaan voor; zonder facturen worden schattingen gebruikt. Herhaal de toerekening wanneer facturen binnenkomen: de werkelijke landed cost wordt apart van de schatting opgeslagen en de voorraadwaarde wordt bijgewerkt.{s.costs_allocated_at && ` Laatst toegerekend: ${formatDate(s.costs_allocated_at, true)}.`}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Ontvangst in Suriname</CardTitle></CardHeader>
          <CardContent>
            {!openReceipt ? <p className="text-sm text-taupe">{(lines ?? []).length ? "Alle regels zijn verwerkt." : "Voeg eerst regels toe."}</p> : (
              <ActionForm action={receiveShipmentAction} className="space-y-2 text-sm" confirm="Ontvangst verwerken? Alleen ontvangen aantallen worden voorraad en worden toegewezen aan wachtende pre-orders.">
                <input type="hidden" name="shipmentId" value={id} />
                <select name="locationId" className="h-9 w-full rounded-md border px-2">{(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                {(lines ?? []).filter((l) => l.quantity_received + l.quantity_damaged < l.quantity_shipped).map((l) => {
                  const remaining = l.quantity_shipped - l.quantity_received - l.quantity_damaged;
                  return (
                    <div key={l.id} className="flex items-center justify-between gap-2">
                      <span className="text-xs">{(l.product_variants as unknown as { sku: string }).sku} (open {remaining})</span>
                      <span className="flex gap-1">
                        <input name={`recv_${l.id}`} type="number" min={0} max={remaining} defaultValue={0} className="h-8 w-16 rounded border px-1" aria-label="Ontvangen" />
                        <input name={`dmg_${l.id}`} type="number" min={0} max={remaining} defaultValue={0} className="h-8 w-16 rounded border px-1" aria-label="Beschadigd" />
                      </span>
                    </div>
                  );
                })}
                <p className="text-xs text-taupe">Kolommen: ontvangen in goede staat / beschadigd.</p>
                {s.costs_allocated_at == null && <Alert variant="warning">Kosten zijn nog niet toegerekend. U kunt toch ontvangen; de kostprijs wordt later bijgewerkt bij toerekening.</Alert>}
                <SubmitButton size="sm">Ontvangst verwerken</SubmitButton>
              </ActionForm>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Gegevens</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={saveShipmentAction} className="grid gap-2 text-sm sm:grid-cols-4">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="supplier_id" value={s.supplier_id ?? ""} />
            <label>Agent<input name="shipping_agent" defaultValue={s.shipping_agent ?? ""} className="block h-9 w-full rounded-md border px-2" /></label>
            <label>Methode<input name="shipping_method" defaultValue={s.shipping_method ?? ""} className="block h-9 w-full rounded-md border px-2" /></label>
            <label>Tracking<input name="tracking_number" defaultValue={s.tracking_number ?? ""} className="block h-9 w-full rounded-md border px-2" /></label>
            <label>Vertrek<input name="departure_date" type="date" defaultValue={s.departure_date ?? ""} className="block h-9 w-full rounded-md border px-2" /></label>
            <label>Verwachte aankomst<input name="estimated_arrival" type="date" defaultValue={s.estimated_arrival ?? ""} className="block h-9 w-full rounded-md border px-2" /></label>
            <label>Totaal gewicht (kg)<input name="total_weight_kg" type="number" step="0.001" defaultValue={s.total_weight_kg ?? ""} className="block h-9 w-full rounded-md border px-2" /></label>
            <label>Totaal volume (m³)<input name="total_volume_m3" type="number" step="0.000001" defaultValue={s.total_volume_m3 ?? ""} className="block h-9 w-full rounded-md border px-2" /></label>
            <label className="sm:col-span-4">Notities<textarea name="notes" defaultValue={s.notes ?? ""} className="block w-full rounded-md border p-2" rows={2} /></label>
            <div><SubmitButton size="sm" variant="outline">Opslaan</SubmitButton></div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
