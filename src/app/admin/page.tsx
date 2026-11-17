import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, Stat } from "@/components/admin/page-header";
import { LineSeries } from "@/components/admin/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { adminNav } from "@/components/admin/nav";
import { can, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { orderStatusLabel, statusVariant } from "@/lib/labels";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const session = await requireStaff();
  if (!can(session, "dashboard.view")) {
    const first = adminNav.flatMap((g) => g.items).find((i) => can(session, i.perm));
    redirect(first?.href ?? "/admin/geen-toegang");
  }
  const supabase = await createClient();
  const today = new Date();
  const from = new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const [{ data: stats, error }, { data: recent }, report, { data: low }] = await Promise.all([
    supabase.rpc("dashboard_stats"),
    supabase.from("orders").select("id, order_number, customer_name, total, status, created_at").order("created_at", { ascending: false }).limit(8),
    can(session, "reports.view") ? supabase.rpc("report_data", { _from: from, _to: today.toISOString().slice(0, 10) }) : Promise.resolve({ data: null }),
    can(session, "inventory.manage") ? supabase.from("inventory_overview").select("variant_id, sku, title, available_qty, low_stock_threshold").eq("is_low", true).eq("sales_type", "ready").eq("product_status", "active").limit(8) : Promise.resolve({ data: [] }),
  ]);
  if (error) throw new Error(error.message);
  const s = stats as Record<string, number>;
  const series = ((report.data as { sales_by_day?: Record<string, unknown>[] } | null)?.sales_by_day ?? []).map((d) => ({ ...d, day: String(d.day).slice(5) }));

  return (
    <div>
      <PageHeader title="Dashboard" description="Live cijfers uit de database. Omzet = geleverde bestellingen; aanbetalingen op lopende bestellingen tellen niet als omzet." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
        <Stat label="Bestellingen (actief + afgerond)" value={s.total_orders} href="/admin/orders" />
        <Stat label="Wacht op betaling" value={s.orders_awaiting_payment} href="/admin/orders?status=awaiting_deposit" />
        <Stat label="Betalingen te verifiëren" value={s.payments_to_verify} href="/admin/payments" />
        <Stat label="Aanbetalingen ontvangen (lopend)" value={formatSRD(s.deposits_received)} hint="Klantgelden, nog geen omzet" />
        <Stat label="Openstaande saldi" value={formatSRD(s.outstanding_balances)} href="/admin/finance" />
        <Stat label="Ready-stock bestellingen" value={s.ready_stock_orders} />
        <Stat label="Pre-orders" value={s.preorders} href="/admin/preorders" />
        <Stat label="Omzet deze week" value={formatSRD(s.weekly_sales)} />
        <Stat label="Omzet deze maand" value={formatSRD(s.monthly_sales)} />
        <Stat label="Voorraadwaarde (kostprijs)" value={formatSRD(s.inventory_value)} hint={`${s.inventory_units} stuks`} />
        <Stat label="Lage voorraad" value={s.low_stock} href="/admin/inventory?low=1" />
        <Stat label="Te kopen pre-order stuks" value={s.pending_purchases} href="/admin/purchasing" />
        <Stat label="Actieve zendingen" value={s.active_shipments} href="/admin/shipments" />
        <Stat label="Wacht op levering" value={s.awaiting_delivery} href="/admin/deliveries" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {series.length > 0 && (
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle>Laatste 30 dagen</CardTitle></CardHeader>
            <CardContent><LineSeries data={series} x="day" lines={[{ key: "order_value", label: "Bestelwaarde (SRD)" }, { key: "revenue", label: "Omzet geleverd (SRD)" }]} /></CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>Recente bestellingen</CardTitle></CardHeader>
          <CardContent>
            {(recent ?? []).length === 0 ? <p className="text-sm text-taupe">Nog geen bestellingen.</p> : (
              <ul className="divide-y text-sm">
                {(recent ?? []).map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/admin/orders/${o.id}`} className="min-w-0">
                      <span className="font-medium">{o.order_number}</span>
                      <span className="block truncate text-xs text-taupe">{o.customer_name} · {formatDate(o.created_at)}</span>
                    </Link>
                    <div className="text-right"><div>{formatSRD(o.total)}</div><Badge variant={statusVariant(o.status)}>{orderStatusLabel[o.status]}</Badge></div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {(low ?? []).length > 0 && (
          <Card>
            <CardHeader><CardTitle>Lage voorraad</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {(low ?? []).map((l) => <li key={l.variant_id} className="flex justify-between py-2"><span className="truncate">{l.title} <span className="text-xs text-taupe">{l.sku}</span></span><span className="font-medium">{l.available_qty}</span></li>)}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
