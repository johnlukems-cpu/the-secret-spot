import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { addLocationAction, adjustInventoryAction, setThresholdAction, transferStockAction } from "./actions";

export const metadata = { title: "Voorraad" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string; low?: string; tab?: string }> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("inventory_overview").select("*");
  if (sp.low) q = q.eq("is_low", true);
  if (sp.q) { const t = sp.q.replace(/[%,()]/g, ""); q = q.or(`title.ilike.%${t}%,sku.ilike.%${t}%`); }
  const [{ data: rows }, { data: locations }, { data: variants }, { data: movements }] = await Promise.all([
    q.order("title").limit(300),
    supabase.from("storage_locations").select("id, code, name, is_default").eq("is_active", true).order("is_default", { ascending: false }),
    supabase.from("product_variants").select("id, sku, size, color, products!inner(title, sales_type)").is("deleted_at", null).order("sku").limit(1000),
    supabase.from("inventory_movements").select("id, created_at, movement_type, quantity, reserved_change, reason, product_variants(sku)").order("created_at", { ascending: false }).limit(sp.tab === "movements" ? 200 : 0),
  ]);
  const totalValue = (rows ?? []).reduce((s, r) => s + r.physical_qty * Number(r.unit_cost ?? 0), 0);
  const locOptions = (locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>);

  return (
    <div className="space-y-6">
      <PageHeader title="Voorraad" description="Beschikbaar = fysiek − gereserveerd. Elke wijziging wordt vastgelegd met reden, gebruiker en tijdstip."
        actions={<>
          <Button asChild size="sm" variant={sp.tab === "movements" ? "outline" : "default"}><Link href="/admin/inventory">Voorraad</Link></Button>
          <Button asChild size="sm" variant={sp.tab === "movements" ? "default" : "outline"}><Link href="/admin/inventory?tab=movements">Mutaties</Link></Button>
        </>} />

      {sp.tab === "movements" ? (
        <Table>
          <THead><TR><TH>Datum</TH><TH>SKU</TH><TH>Type</TH><TH className="text-right">Fysiek</TH><TH className="text-right">Gereserveerd</TH><TH>Reden</TH></TR></THead>
          <TBody>
            {(movements ?? []).length === 0 && <EmptyRow cols={6}>Geen mutaties.</EmptyRow>}
            {(movements ?? []).map((m) => (
              <TR key={m.id}><TD>{formatDate(m.created_at, true)}</TD><TD>{(m.product_variants as unknown as { sku: string })?.sku}</TD><TD>{m.movement_type}</TD>
                <TD className="text-right tabular-nums">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</TD><TD className="text-right tabular-nums">{m.reserved_change || ""}</TD><TD className="text-xs">{m.reason}</TD></TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Voorraad mutatie</CardTitle></CardHeader>
              <CardContent>
                <ActionForm action={adjustInventoryAction} className="space-y-2 text-sm" reset>
                  <select name="variantId" required className="h-9 w-full rounded-md border px-2">
                    <option value="">Kies variant…</option>
                    {(variants ?? []).map((v) => <option key={v.id} value={v.id}>{v.sku} – {(v.products as unknown as { title: string }).title}</option>)}
                  </select>
                  <select name="locationId" className="h-9 w-full rounded-md border px-2">{locOptions}</select>
                  <select name="kind" className="h-9 w-full rounded-md border px-2">
                    <option value="add">Toevoegen (inkoop/ontvangst)</option><option value="remove">Afboeken</option>
                    <option value="damaged">Beschadigd</option><option value="returned">Retour (weer verkoopbaar)</option><option value="correction">Correctie (telling = nieuw aantal)</option>
                  </select>
                  <div className="flex gap-2"><input name="qty" type="number" min="0" required placeholder="Aantal" className="h-9 w-full rounded-md border px-2" /><input name="unitCost" type="number" step="0.01" placeholder="Kostprijs/st (SRD)" className="h-9 w-full rounded-md border px-2" /></div>
                  <input name="reason" required placeholder="Reden (verplicht)" className="h-9 w-full rounded-md border px-2" />
                  <SubmitButton size="sm" className="w-full">Verwerken</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Verplaatsen tussen locaties</CardTitle></CardHeader>
              <CardContent>
                <ActionForm action={transferStockAction} className="space-y-2 text-sm" reset>
                  <select name="variantId" required className="h-9 w-full rounded-md border px-2"><option value="">Kies variant…</option>{(variants ?? []).map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}</select>
                  <div className="flex gap-2"><select name="from" className="h-9 w-full rounded-md border px-2" aria-label="Van">{locOptions}</select><select name="to" className="h-9 w-full rounded-md border px-2" aria-label="Naar">{locOptions}</select></div>
                  <input name="qty" type="number" min="1" required placeholder="Aantal" className="h-9 w-full rounded-md border px-2" />
                  <input name="reason" required placeholder="Reden" className="h-9 w-full rounded-md border px-2" />
                  <SubmitButton size="sm" variant="outline" className="w-full">Verplaatsen</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Opslaglocaties</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <ul>{(locations ?? []).map((l) => <li key={l.id}>{l.code} – {l.name}{l.is_default && " (standaard)"}</li>)}</ul>
                <ActionForm action={addLocationAction} className="flex gap-2" reset>
                  <input name="code" required placeholder="Code" className="h-9 w-20 rounded-md border px-2" /><input name="name" required placeholder="Naam" className="h-9 flex-1 rounded-md border px-2" />
                  <SubmitButton size="sm" variant="outline">+</SubmitButton>
                </ActionForm>
                <p className="pt-2 text-xs text-taupe">Totale voorraadwaarde (getoonde regels): {formatSRD(totalValue)}</p>
              </CardContent>
            </Card>
          </div>

          <form className="flex flex-wrap gap-2">
            <input name="q" defaultValue={sp.q} placeholder="Zoek product of SKU" className="h-9 w-56 rounded-md border px-3 text-sm" />
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={!!sp.low} /> Alleen lage voorraad</label>
            <Button size="sm">Filter</Button>
          </form>
          <Table>
            <THead><TR><TH>Product / SKU</TH><TH>Locatie</TH><TH className="text-right">Fysiek</TH><TH className="text-right">Gereserv.</TH><TH className="text-right">Beschikb.</TH><TH className="text-right">Beschadigd</TH><TH className="text-right">Retour</TH><TH className="text-right">Kostprijs</TH><TH>Drempel</TH></TR></THead>
            <TBody>
              {(rows ?? []).length === 0 && <EmptyRow cols={9}>Geen voorraadregels.</EmptyRow>}
              {(rows ?? []).map((r) => (
                <TR key={r.id} className={r.is_low && r.sales_type === "ready" ? "bg-amber-50/60" : ""}>
                  <TD>{r.title}<div className="text-xs text-taupe">{r.sku} · {[r.color, r.size].filter(Boolean).join(" / ")}</div></TD>
                  <TD className="text-xs">{r.location_name}</TD>
                  <TD className="text-right tabular-nums">{r.physical_qty}</TD>
                  <TD className="text-right tabular-nums">{r.reserved_qty}</TD>
                  <TD className="text-right font-medium tabular-nums">{r.available_qty}</TD>
                  <TD className="text-right tabular-nums">{r.damaged_qty}</TD>
                  <TD className="text-right tabular-nums">{r.returned_qty}</TD>
                  <TD className="text-right tabular-nums">{r.unit_cost ? formatSRD(r.unit_cost) : "–"}</TD>
                  <TD>
                    <ActionForm action={setThresholdAction} className="flex gap-1"><input type="hidden" name="id" value={r.id} /><input name="threshold" type="number" min="0" defaultValue={r.low_stock_threshold} className="h-8 w-14 rounded border px-1 text-xs" aria-label="Drempel" /><button className="text-xs underline">ok</button></ActionForm>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}
