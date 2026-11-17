import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Bars, Donut, LineSeries } from "@/components/admin/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { PeriodLinks, resolvePeriod } from "../_period";

export const metadata = { title: "Rapportages" };
type R = Record<string, unknown>;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; period?: string }> }) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const p = resolvePeriod(sp.period || sp.from ? sp : { period: "month" });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_data", { _from: p.from, _to: p.to });
  if (error) throw new Error(error.message);
  const r = data as Record<string, R[] & R>;
  const n = (v: unknown) => Number(v ?? 0);
  const exp = (k: string) => `/api/admin/export/report?key=${k}&from=${p.from}&to=${p.to}`;
  const turnover = r.inventory_turnover as unknown as R;
  const delivery = r.delivery_performance as unknown as R;
  const retention = r.customer_retention as unknown as R;
  return (
    <div className="space-y-6">
      <PageHeader title="Rapportages" description={`${p.label} · alle cijfers uit echte database-records`} actions={<>
        {PeriodLinks({ base: "/admin/reports" }).map((l) => <Button key={l.key} asChild size="sm" variant="outline"><Link href={l.href}>{l.label}</Link></Button>)}
        <Button asChild size="sm" variant="outline"><a href={`/api/admin/reports/pdf?from=${p.from}&to=${p.to}`}>PDF</a></Button>
      </>} />
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <label>Van<input type="date" name="from" defaultValue={p.from} className="block h-9 rounded-md border px-2" /></label>
        <label>Tot<input type="date" name="to" defaultValue={p.to} className="block h-9 rounded-md border px-2" /></label>
        <Button size="sm">Toon</Button>
      </form>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="xl:col-span-2"><CardHeader className="flex-row justify-between"><CardTitle>Verkoop per dag</CardTitle><a href={exp("sales_by_day")} className="text-xs underline">CSV</a></CardHeader>
          <CardContent><LineSeries data={(r.sales_by_day ?? []) as R[]} x="day" lines={[{ key: "order_value", label: "Bestelwaarde" }, { key: "revenue", label: "Omzet (geleverd)" }]} /></CardContent></Card>
        <Card><CardHeader className="flex-row justify-between"><CardTitle>Omzet per maand</CardTitle><a href={exp("sales_by_month")} className="text-xs underline">CSV</a></CardHeader><CardContent><Bars data={(r.sales_by_month ?? []) as R[]} x="month" y="revenue" label="Omzet" /></CardContent></Card>
        <Card><CardHeader className="flex-row justify-between"><CardTitle>Omzet per categorie</CardTitle><a href={exp("sales_by_category")} className="text-xs underline">CSV</a></CardHeader><CardContent><Bars data={((r.sales_by_category ?? []) as R[]).map((x) => ({ ...x, revenue: n(x.revenue) }))} x="category" y="revenue" label="Omzet" horizontal /></CardContent></Card>
        <Card><CardHeader className="flex-row justify-between"><CardTitle>Ready-stock vs pre-order</CardTitle><a href={exp("ready_vs_preorder")} className="text-xs underline">CSV</a></CardHeader><CardContent><Donut data={((r.ready_vs_preorder ?? []) as R[]).map((x) => ({ name: x.sales_type === "ready" ? "Ready-stock" : "Pre-order", value: n(x.revenue) }))} nameKey="name" valueKey="value" /></CardContent></Card>
        <Card><CardHeader className="flex-row justify-between"><CardTitle>Populaire maten / kleuren</CardTitle><a href={exp("popular_sizes")} className="text-xs underline">CSV</a></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2"><Bars data={((r.popular_sizes ?? []) as R[]).slice(0, 8).map((x) => ({ ...x, units: n(x.units) }))} x="size" y="units" label="Stuks" height={200} /><Bars data={((r.popular_colors ?? []) as R[]).slice(0, 8).map((x) => ({ ...x, units: n(x.units) }))} x="color" y="units" label="Stuks" height={200} /></CardContent></Card>
      </div>
      <Card><CardHeader className="flex-row justify-between"><CardTitle>Producten (omzet & winst)</CardTitle><a href={exp("sales_by_product")} className="text-xs underline">CSV</a></CardHeader>
        <CardContent><Table><THead><TR><TH>Product</TH><TH className="text-right">Stuks</TH><TH className="text-right">Omzet</TH><TH className="text-right">Kostprijs</TH><TH className="text-right">Winst</TH></TR></THead><TBody>
          {((r.sales_by_product ?? []) as R[]).length === 0 && <EmptyRow cols={5}>Geen geleverde verkopen in deze periode.</EmptyRow>}
          {[...((r.sales_by_product ?? []) as R[])].sort((a, b) => n(b.profit) - n(a.profit)).map((x) => (
            <TR key={String(x.product_id)}><TD>{String(x.title)}</TD><TD className="text-right">{n(x.units)}</TD><TD className="text-right">{formatSRD(n(x.revenue))}</TD><TD className="text-right">{x.cost_known ? formatSRD(n(x.cost)) : "onvolledig"}</TD><TD className="text-right">{x.cost_known ? formatSRD(n(x.profit)) : "–"}</TD></TR>
          ))}
        </TBody></Table></CardContent></Card>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card><CardHeader><CardTitle>Voorraadomloop</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
          <p>Verkochte stuks: {n(turnover.units_sold)}</p><p>COGS: {formatSRD(n(turnover.cogs))}</p><p>Huidige voorraad: {n(turnover.current_units)} stuks / {formatSRD(n(turnover.current_value))}</p>
          <p>Omloopsnelheid (periode): {n(turnover.current_value) > 0 ? (n(turnover.cogs) / n(turnover.current_value)).toFixed(2) : "–"}×</p>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Leverprestaties</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
          <p>Geleverd: {n(delivery.delivered)}</p><p>Mislukt: {n(delivery.failed)}</p><p>Opnieuw ingepland: {n(delivery.rescheduled)}</p><p>Gem. uren klaar → geleverd: {delivery.avg_hours_ready_to_delivered != null ? n(delivery.avg_hours_ready_to_delivered) : "–"}</p>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Klantbehoud</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
          <p>Klanten met bestellingen: {n(retention.customers_with_orders)}</p><p>Terugkerende klanten: {n(retention.repeat_customers)}</p><p>Herhaalaankoop: {n(retention.repeat_rate_pct)}%</p>
        </CardContent></Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader className="flex-row justify-between"><CardTitle>Langzaam lopende voorraad (&gt;30 dagen)</CardTitle><a href={exp("slow_moving")} className="text-xs underline">CSV</a></CardHeader>
          <CardContent><Table><THead><TR><TH>Artikel</TH><TH className="text-right">Voorraad</TH><TH>Laatste verkoop</TH></TR></THead><TBody>
            {((r.slow_moving ?? []) as R[]).length === 0 && <EmptyRow cols={3}>Geen.</EmptyRow>}
            {((r.slow_moving ?? []) as R[]).map((x) => <TR key={String(x.sku)}><TD>{String(x.title)}<div className="text-xs text-taupe">{String(x.sku)}</div></TD><TD className="text-right">{n(x.on_hand)}</TD><TD className="text-xs">{x.last_sale ? formatDate(String(x.last_sale)) : "nooit"}</TD></TR>)}
          </TBody></Table></CardContent></Card>
        <Card><CardHeader className="flex-row justify-between"><CardTitle>Leveranciersprestaties</CardTitle><a href={exp("supplier_performance")} className="text-xs underline">CSV</a></CardHeader>
          <CardContent><Table><THead><TR><TH>Leverancier</TH><TH className="text-right">PO&apos;s</TH><TH className="text-right">Besteld</TH><TH className="text-right">Ontvangen</TH><TH className="text-right">Beschadigd</TH><TH className="text-right">Dagen tot bevestiging</TH></TR></THead><TBody>
            {((r.supplier_performance ?? []) as R[]).length === 0 && <EmptyRow cols={6}>Geen.</EmptyRow>}
            {((r.supplier_performance ?? []) as R[]).map((x) => <TR key={String(x.name)}><TD>{String(x.name)}</TD><TD className="text-right">{n(x.purchase_orders)}</TD><TD className="text-right">{n(x.units_ordered)}</TD><TD className="text-right">{n(x.units_received)}</TD><TD className="text-right">{n(x.units_damaged)}</TD><TD className="text-right">{x.avg_days_to_confirm != null ? String(x.avg_days_to_confirm) : "–"}</TD></TR>)}
          </TBody></Table></CardContent></Card>
      </div>
      <Card><CardHeader className="flex-row justify-between"><CardTitle>Zendingskosten & winstgevendheid</CardTitle><a href={exp("shipment_costs")} className="text-xs underline">CSV</a></CardHeader>
        <CardContent><Table><THead><TR><TH>Zending</TH><TH>Status</TH><TH className="text-right">Goederen</TH><TH className="text-right">Kosten (werkelijk)</TH><TH className="text-right">Kosten (schatting)</TH><TH className="text-right">Verkoopwaarde ontvangen</TH></TR></THead><TBody>
          {((r.shipment_costs ?? []) as R[]).length === 0 && <EmptyRow cols={6}>Geen zendingen.</EmptyRow>}
          {((r.shipment_costs ?? []) as R[]).map((x) => <TR key={String(x.shipment_number)}><TD>{String(x.shipment_number)}</TD><TD className="text-xs">{String(x.status)}</TD><TD className="text-right">{formatSRD(n(x.goods_value))}</TD><TD className="text-right">{formatSRD(n(x.actual_costs))}</TD><TD className="text-right">{formatSRD(n(x.estimated_costs))}</TD><TD className="text-right">{formatSRD(n(x.retail_value_received))}</TD></TR>)}
        </TBody></Table></CardContent></Card>
    </div>
  );
}
