import Link from "next/link";
import { PageHeader, Stat } from "@/components/admin/page-header";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { orderStatusLabel } from "@/lib/labels";
import { PeriodLinks, resolvePeriod } from "../_period";

export const metadata = { title: "Financieel overzicht" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; period?: string }> }) {
  await requirePermission("finance.view");
  const sp = await searchParams;
  const p = resolvePeriod(sp);
  const supabase = await createClient();
  const [{ data, error }, { data: balances }] = await Promise.all([
    supabase.rpc("financial_summary", { _from: p.from, _to: p.to }),
    supabase.rpc("outstanding_balances"),
  ]);
  if (error) throw new Error(error.message);
  const f = data as Record<string, number>;
  return (
    <div className="space-y-6">
      <PageHeader title="Financieel overzicht" description={`${p.label} · Omzet wordt erkend bij levering. Aanbetalingen op niet-geleverde bestellingen zijn klantgelden (verplichting), geen omzet.`}
        actions={<>
          {PeriodLinks({ base: "/admin/finance" }).map((l) => <Button key={l.key} asChild size="sm" variant={sp.period === l.key || (!sp.period && !sp.from && l.key === "month") ? "default" : "outline"}><Link href={l.href}>{l.label}</Link></Button>)}
          <Button asChild size="sm" variant="outline"><a href={`/api/admin/export/finance?from=${p.from}&to=${p.to}`}>CSV</a></Button>
        </>} />
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <label>Van<input type="date" name="from" defaultValue={p.from} className="block h-9 rounded-md border px-2" /></label>
        <label>Tot<input type="date" name="to" defaultValue={p.to} className="block h-9 rounded-md border px-2" /></label>
        <Button size="sm">Toon</Button>
      </form>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Resultaat (operationeel)</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Bruto omzet (geleverd, na korting)" value={formatSRD(f.gross_sales)} />
          <Stat label="· waarvan ready-stock" value={formatSRD(f.ready_stock_sales)} />
          <Stat label="· waarvan pre-order" value={formatSRD(f.preorder_sales)} />
          <Stat label="Bezorginkomsten" value={formatSRD(f.delivery_income)} />
          <Stat label="Kostprijs verkopen (COGS)" value={formatSRD(f.cost_of_goods_sold)} hint="Landed cost van geleverde stuks" />
          <Stat label="Brutowinst" value={formatSRD(f.gross_profit)} hint={`${f.gross_margin_pct}% marge`} />
          <Stat label="Bezorgkosten" value={formatSRD(f.delivery_expenses)} />
          <Stat label="Bedrijfskosten" value={formatSRD(f.operating_expenses)} />
          <Stat label="Terugbetalingen" value={formatSRD(f.refunds)} />
          <Stat label="Netto operationeel resultaat" value={formatSRD(f.net_operating_result)} />
          <Stat label="Vrachtkosten zendingen (info)" value={formatSRD(f.shipping_costs)} hint="Zit in landed cost / COGS" />
          <Stat label="Import- en douanekosten (info)" value={formatSRD(f.import_charges)} hint="Zit in landed cost / COGS" />
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Balansposten (nu)</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Klant-aanbetalingen (verplichting)" value={formatSRD(f.customer_deposits_held)} />
          <Stat label="Debiteuren (geleverd, onbetaald)" value={formatSRD(f.customer_receivables)} />
          <Stat label="Geld op geannuleerde bestellingen" value={formatSRD(f.cancelled_orders_holding_funds)} hint="Terugbetalen of verrekenen volgens voorwaarden" />
          <Stat label="Te betalen aan leveranciers" value={formatSRD(f.supplier_balances)} hint="Op basis van huidige koersen" />
          <Stat label="Voorraadwaarde (kostprijs)" value={formatSRD(f.inventory_valuation)} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Kasstroom in periode</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Ontvangen (geverifieerd)" value={formatSRD(f.cash_in)} />
          <Stat label="Betaald aan leveranciers" value={formatSRD(f.supplier_payments)} />
          <Stat label="Totaal uitgaand" value={formatSRD(f.cash_out)} />
          <Stat label="Netto kasstroom" value={formatSRD(Number(f.cash_in) - Number(f.cash_out))} />
        </div>
      </section>
      <Card>
        <CardHeader><CardTitle>Openstaande klantsaldi</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>Bestelling</TH><TH>Klant</TH><TH>Status</TH><TH className="text-right">Totaal</TH><TH className="text-right">Betaald</TH><TH className="text-right">Open</TH></TR></THead>
            <TBody>
              {((balances ?? []) as { order_id: string; order_number: string; customer_name: string; status: string; total: string; amount_verified: string; balance_due: string; created_at: string }[]).length === 0 && <EmptyRow cols={6}>Geen openstaande saldi.</EmptyRow>}
              {((balances ?? []) as { order_id: string; order_number: string; customer_name: string; status: string; total: string; amount_verified: string; balance_due: string; created_at: string }[]).map((b) => (
                <TR key={b.order_id}><TD><Link href={`/admin/orders/${b.order_id}`} className="underline">{b.order_number}</Link><div className="text-xs text-taupe">{formatDate(b.created_at)}</div></TD><TD>{b.customer_name}</TD><TD className="text-xs">{orderStatusLabel[b.status]}</TD>
                  <TD className="text-right">{formatSRD(b.total)}</TD><TD className="text-right">{formatSRD(b.amount_verified)}</TD><TD className="text-right font-medium">{formatSRD(b.balance_due)}</TD></TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-taupe">Dit is een operationeel managementoverzicht en vervangt geen volledige (wettelijke) boekhouding. Zie BUSINESS_RULES.md voor de gebruikte definities.</p>
    </div>
  );
}
