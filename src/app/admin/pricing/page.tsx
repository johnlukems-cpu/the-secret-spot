import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { SubmitButton } from "@/components/ui/submit-button";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { Calculator } from "./calculator";
import { addExchangeRateAction } from "./actions";

export const metadata = { title: "Prijscalculator" };

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const session = await requirePermission("pricing.manage");
  const { product } = await searchParams;
  const supabase = await createClient();
  const [{ data: rates }, { data: settings }, { data: products }, { data: calcs }] = await Promise.all([
    supabase.from("exchange_rates").select("id, from_currency, to_currency, rate, effective_date, source").order("effective_date", { ascending: false }).limit(200),
    supabase.from("pricing_settings").select("*").eq("is_default", true).maybeSingle(),
    supabase.from("products").select("id, title, sku, base_price, product_variants(id, sku)").is("deleted_at", null).neq("status", "archived").order("title").limit(1000),
    supabase.from("cost_calculations").select("id, created_at, is_estimate, landed_cost_srd, final_price_srd, actual_margin_pct, supplier_price, supplier_currency, exchange_rate, products(title), shipments(shipment_number)").order("created_at", { ascending: false }).limit(30),
  ]);
  return (
    <div className="space-y-8">
      <PageHeader title="Prijscalculator" description="Bereken landed cost en verkoopprijs vóór publicatie. Geschatte en werkelijke (na zending) kostprijzen worden apart opgeslagen." />
      <Calculator rates={(rates ?? []) as never} defaults={settings as never} initialProductId={product} canApply={can(session, "products.manage")}
        products={(products ?? []).map((p) => ({ id: p.id, title: p.title, sku: p.sku, base_price: p.base_price, variants: p.product_variants ?? [] }))} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Wisselkoersen (historie)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ActionForm action={addExchangeRateAction} className="flex flex-wrap items-end gap-2 text-sm" reset>
              <select name="from" className="h-9 rounded-md border px-2">{["CNY", "USD", "EUR", "SRD"].map((c) => <option key={c}>{c}</option>)}</select>
              <span className="pb-2">→</span>
              <select name="to" defaultValue="SRD" className="h-9 rounded-md border px-2">{["SRD", "EUR", "USD", "CNY"].map((c) => <option key={c}>{c}</option>)}</select>
              <input name="rate" type="number" step="0.00000001" required placeholder="1 van = ? naar" className="h-9 w-32 rounded-md border px-2" />
              <input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="h-9 rounded-md border px-2" />
              <input name="source" placeholder="Bron (CBvS, bank…)" className="h-9 w-36 rounded-md border px-2" />
              <SubmitButton size="sm">Toevoegen</SubmitButton>
            </ActionForm>
            <Table>
              <THead><TR><TH>Datum</TH><TH>Paar</TH><TH className="text-right">Koers</TH><TH>Bron</TH></TR></THead>
              <TBody>
                {(rates ?? []).length === 0 && <EmptyRow cols={4}>Nog geen koersen ingesteld. Het systeem gaat nooit uit van een vaste koers.</EmptyRow>}
                {(rates ?? []).slice(0, 30).map((r) => <TR key={r.id}><TD>{formatDate(r.effective_date)}</TD><TD>{r.from_currency} → {r.to_currency}</TD><TD className="text-right tabular-nums">{Number(r.rate)}</TD><TD className="text-xs">{r.source}</TD></TR>)}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recente berekeningen</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <THead><TR><TH>Datum</TH><TH>Product</TH><TH>Soort</TH><TH className="text-right">Landed</TH><TH className="text-right">Prijs</TH><TH className="text-right">Marge</TH></TR></THead>
              <TBody>
                {(calcs ?? []).length === 0 && <EmptyRow cols={6}>Nog geen berekeningen.</EmptyRow>}
                {(calcs ?? []).map((c) => (
                  <TR key={c.id}>
                    <TD className="text-xs">{formatDate(c.created_at)}</TD><TD className="text-xs">{(c.products as unknown as { title: string } | null)?.title ?? "–"}</TD>
                    <TD className="text-xs">{c.is_estimate ? "Schatting" : `Werkelijk (${(c.shipments as unknown as { shipment_number: string } | null)?.shipment_number ?? ""})`}</TD>
                    <TD className="text-right tabular-nums">{formatSRD(c.landed_cost_srd)}</TD><TD className="text-right tabular-nums">{formatSRD(c.final_price_srd)}</TD><TD className="text-right">{Number(c.actual_margin_pct).toFixed(1)}%</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
