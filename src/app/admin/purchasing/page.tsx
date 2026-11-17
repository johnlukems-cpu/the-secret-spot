import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, type Currency } from "@/lib/money";
import { createBatchAction } from "./actions";

export const metadata = { title: "Inkooprapport" };

type Row = { supplier_id: string | null; supplier_name: string | null; product_title: string; sku: string; size: string | null; color: string | null; total_units: number; supplier_unit_cost: string | null; supplier_currency: Currency | null; total_supplier_cost: string; order_count: number };

export default async function PurchasingPage() {
  await requirePermission("purchasing.manage");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("purchasing_report");
  const rows = (data ?? []) as Row[];
  const groups = new Map<string, Row[]>();
  rows.forEach((r) => { const k = r.supplier_id ?? "none"; groups.set(k, [...(groups.get(k) ?? []), r]); });
  return (
    <div className="space-y-6">
      <PageHeader title="Wekelijks inkooprapport" description="Alle bevestigde pre-order eenheden waarvan de aanbetaling is geverifieerd en die nog niet in een actieve inkoopbatch zitten. Gegroepeerd per leverancier, product, SKU, maat en kleur."
        actions={<Button asChild variant="outline" size="sm"><a href="/api/admin/export/purchasing">CSV exporteren</a></Button>} />
      {error && <Alert variant="error">{error.message}</Alert>}
      {rows.length === 0 && <p className="rounded-lg border border-dashed bg-white p-10 text-center text-sm text-taupe">Geen openstaande pre-order eenheden om in te kopen.</p>}
      {[...groups.entries()].map(([sid, list]) => {
        const totals = list.reduce<Record<string, number>>((acc, r) => { const c = r.supplier_currency ?? "?"; acc[c] = (acc[c] ?? 0) + Number(r.total_supplier_cost); return acc; }, {});
        const missingCost = list.some((r) => r.supplier_unit_cost == null);
        return (
          <section key={sid} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{list[0].supplier_name ?? "Geen standaard leverancier ingesteld"} · {list.reduce((s, r) => s + r.total_units, 0)} stuks · {Object.entries(totals).map(([c, t]) => formatMoney(t, c as Currency)).join(" + ")}</h2>
              {sid !== "none" ? (
                <ActionForm action={createBatchAction} className="flex gap-2">
                  <input type="hidden" name="supplierId" value={sid} />
                  <input name="notes" placeholder="Notitie batch" className="h-9 rounded-md border px-2 text-sm" />
                  <SubmitButton size="sm">Inkoopbatch aanmaken</SubmitButton>
                </ActionForm>
              ) : <span className="text-xs text-amber-800">Stel per product een standaard leverancier in om te kunnen batchen.</span>}
            </div>
            {missingCost && <Alert variant="warning">Voor sommige artikelen is geen inkoopprijs bekend. Voeg deze toe bij Leveranciers.</Alert>}
            <Table>
              <THead><TR><TH>Product</TH><TH>SKU</TH><TH>Maat</TH><TH>Kleur</TH><TH className="text-right">Stuks</TH><TH className="text-right">Bestellingen</TH><TH className="text-right">Prijs/st</TH><TH className="text-right">Totaal</TH><TH>Status</TH></TR></THead>
              <TBody>
                {list.map((r) => (
                  <TR key={r.sku}>
                    <TD>{r.product_title}</TD><TD className="text-xs">{r.sku}</TD><TD>{r.size ?? "–"}</TD><TD>{r.color ?? "–"}</TD>
                    <TD className="text-right font-medium">{r.total_units}</TD><TD className="text-right">{r.order_count}</TD>
                    <TD className="text-right tabular-nums">{r.supplier_unit_cost != null ? formatMoney(r.supplier_unit_cost, r.supplier_currency ?? "CNY") : "–"}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(r.total_supplier_cost, r.supplier_currency ?? "CNY")}</TD>
                    <TD className="text-xs">Te kopen</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>
        );
      })}
      <p className="text-xs text-taupe">Geschatte verzendkosten worden per zending vastgelegd (module Zendingen) en via de prijscalculator per stuk toegerekend.</p>
    </div>
  );
}
