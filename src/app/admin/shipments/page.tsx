import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { shipmentStatusLabel, statusVariant } from "@/lib/labels";
import { saveShipmentAction } from "./actions";

export const metadata = { title: "Zendingen" };

export default async function ShipmentsPage() {
  await requirePermission("shipments.manage");
  const supabase = await createClient();
  const [{ data }, { data: suppliers }] = await Promise.all([
    supabase.from("shipments").select("id, shipment_number, status, shipping_method, shipping_agent, tracking_number, departure_date, estimated_arrival, actual_arrival, costs_allocated_at, suppliers(name), shipment_items(quantity_shipped, quantity_received), import_costs(amount_srd, is_estimate)").order("created_at", { ascending: false }).limit(100),
    supabase.from("suppliers").select("id, name").is("deleted_at", null).order("name"),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Zendingen" description="Eén zending kan regels uit meerdere inkooporders bevatten; een inkooporder kan over meerdere zendingen verdeeld worden." />
      <Card>
        <CardHeader><CardTitle>Nieuwe zending</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={saveShipmentAction} className="flex flex-wrap items-end gap-2 text-sm">
            <select name="supplier_id" className="h-9 rounded-md border px-2"><option value="">Leverancier (optioneel)…</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <input name="shipping_agent" placeholder="Verzendagent" className="h-9 rounded-md border px-2" />
            <select name="shipping_method" className="h-9 rounded-md border px-2"><option value="air">Luchtvracht</option><option value="sea">Zeevracht</option><option value="courier">Koerier</option></select>
            <input name="tracking_number" placeholder="Trackingnummer" className="h-9 rounded-md border px-2" />
            <label className="text-xs">Vertrek<input name="departure_date" type="date" className="block h-9 rounded-md border px-2" /></label>
            <label className="text-xs">Verwachte aankomst<input name="estimated_arrival" type="date" className="block h-9 rounded-md border px-2" /></label>
            <SubmitButton size="sm">Aanmaken</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
      <Table>
        <THead><TR><TH>Zending</TH><TH>Leverancier / agent</TH><TH>Status</TH><TH>Vertrek</TH><TH>Aankomst</TH><TH className="text-right">Stuks</TH><TH className="text-right">Kosten</TH></TR></THead>
        <TBody>
          {(data ?? []).length === 0 && <EmptyRow cols={7}>Nog geen zendingen.</EmptyRow>}
          {(data ?? []).map((s) => {
            const items = (s.shipment_items ?? []) as { quantity_shipped: number; quantity_received: number }[];
            const costs = (s.import_costs ?? []) as { amount_srd: string; is_estimate: boolean }[];
            const actual = costs.filter((c) => !c.is_estimate).reduce((a, c) => a + Number(c.amount_srd), 0);
            const est = costs.filter((c) => c.is_estimate).reduce((a, c) => a + Number(c.amount_srd), 0);
            return (
              <TR key={s.id}>
                <TD><Link href={`/admin/shipments/${s.id}`} className="font-medium underline">{s.shipment_number}</Link><div className="text-xs text-taupe">{s.shipping_method} {s.tracking_number && `· ${s.tracking_number}`}</div></TD>
                <TD>{(s.suppliers as unknown as { name: string } | null)?.name ?? "Meerdere"}<div className="text-xs text-taupe">{s.shipping_agent}</div></TD>
                <TD><Badge variant={statusVariant(s.status)}>{shipmentStatusLabel[s.status]}</Badge></TD>
                <TD>{s.departure_date ? formatDate(s.departure_date) : "–"}</TD>
                <TD>{s.actual_arrival ? formatDate(s.actual_arrival) : s.estimated_arrival ? `~${formatDate(s.estimated_arrival)}` : "–"}</TD>
                <TD className="text-right">{items.reduce((a, i) => a + i.quantity_received, 0)}/{items.reduce((a, i) => a + i.quantity_shipped, 0)}</TD>
                <TD className="text-right text-xs">{actual > 0 ? formatSRD(actual) : est > 0 ? `~${formatSRD(est)} (schatting)` : "–"}{s.costs_allocated_at && <div className="text-emerald-700">toegerekend</div>}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
