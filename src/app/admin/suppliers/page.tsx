import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, type Currency } from "@/lib/money";
import { deleteSupplierProductAction, saveSupplierAction, saveSupplierProductAction } from "./actions";

export const metadata = { title: "Leveranciers" };

type S = Record<string, string | number | null> & { id: string; name: string };

function SupplierForm({ s }: { s?: S }) {
  const v = (k: string) => (s?.[k] ?? "") as string;
  return (
    <ActionForm action={saveSupplierAction} className="grid gap-3 md:grid-cols-3" reset={!s}>
      {s && <input type="hidden" name="id" value={s.id} />}
      <Field label="Naam *"><Input name="name" defaultValue={v("name")} required /></Field>
      <Field label="Leverancier-ID"><Input name="code" defaultValue={v("code")} /></Field>
      <Field label="Contactpersoon"><Input name="contact_person" defaultValue={v("contact_person")} /></Field>
      <Field label="E-mail"><Input name="email" type="email" defaultValue={v("email")} /></Field>
      <Field label="WhatsApp / telefoon"><Input name="phone" defaultValue={v("phone")} /></Field>
      <Field label="Website"><Input name="website" defaultValue={v("website")} /></Field>
      <Field label="Platform"><Input name="platform" defaultValue={v("platform")} placeholder="1688, Alibaba, direct…" /></Field>
      <Field label="Land"><Input name="country" defaultValue={v("country") || "China"} /></Field>
      <Field label="Valuta"><Select name="currency" defaultValue={v("currency") || "CNY"}>{["CNY", "USD", "EUR", "SRD"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="Betaalvoorwaarden"><Input name="payment_terms" defaultValue={v("payment_terms")} /></Field>
      <Field label="Verzendmethode"><Input name="shipping_method" defaultValue={v("shipping_method")} /></Field>
      <Field label="Beoordeling (1-5)"><Input name="rating" type="number" min="1" max="5" defaultValue={v("rating")} /></Field>
      <Field label="Notities" className="md:col-span-3"><Textarea name="notes" defaultValue={v("notes")} rows={2} /></Field>
      <div><SubmitButton size="sm">{s ? "Opslaan" : "Leverancier toevoegen"}</SubmitButton></div>
    </ActionForm>
  );
}

export default async function SuppliersPage() {
  await requirePermission("suppliers.manage");
  const supabase = await createClient();
  const [{ data: suppliers }, { data: sp }, { data: variants }] = await Promise.all([
    supabase.from("suppliers").select("*").is("deleted_at", null).order("name"),
    supabase.from("supplier_products").select("id, supplier_id, unit_cost, currency, supplier_sku, supplier_url, min_order_qty, lead_time_days, product_variants(sku), products(title)"),
    supabase.from("product_variants").select("id, sku, products!inner(title)").is("deleted_at", null).order("sku").limit(1000),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Leveranciers" description="Leveranciersprijzen zijn vertrouwelijk en alleen zichtbaar voor bevoegde medewerkers." />
      <Card><CardHeader><CardTitle>Nieuwe leverancier</CardTitle></CardHeader><CardContent><SupplierForm /></CardContent></Card>
      {(suppliers ?? []).map((s) => (
        <details key={s.id} className="rounded-lg border bg-white">
          <summary className="cursor-pointer p-4 text-sm font-medium">{s.name} <span className="font-normal text-taupe">· {s.platform ?? "–"} · {s.currency}{s.rating ? ` · ${"★".repeat(s.rating)}` : ""}</span></summary>
          <div className="space-y-6 border-t p-4">
            <SupplierForm s={s as S} />
            <div>
              <h3 className="mb-2 text-sm font-semibold">Producten & inkoopprijzen</h3>
              <ul className="divide-y text-sm">
                {(sp ?? []).filter((x) => x.supplier_id === s.id).map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span>{(x.products as unknown as { title: string } | null)?.title} <span className="text-xs text-taupe">{(x.product_variants as unknown as { sku: string } | null)?.sku ?? "alle varianten"} {x.supplier_sku && `· lev. ${x.supplier_sku}`}</span></span>
                    <span className="flex items-center gap-3">{formatMoney(x.unit_cost, x.currency as Currency)} · MOQ {x.min_order_qty}{x.lead_time_days != null && ` · ${x.lead_time_days} d`}
                      <ActionForm action={deleteSupplierProductAction} confirm="Verwijderen?"><input type="hidden" name="id" value={x.id} /><button className="text-xs underline">x</button></ActionForm></span>
                  </li>
                ))}
              </ul>
              <ActionForm action={saveSupplierProductAction} className="mt-2 flex flex-wrap items-end gap-2" reset>
                <input type="hidden" name="supplier_id" value={s.id} />
                <select name="variant_id" required className="h-9 rounded-md border px-2 text-sm"><option value="">Variant…</option>{(variants ?? []).map((v) => <option key={v.id} value={v.id}>{v.sku} – {(v.products as unknown as { title: string }).title}</option>)}</select>
                <input name="unit_cost" type="number" step="0.0001" min="0" required placeholder="Inkoopprijs" className="h-9 w-28 rounded-md border px-2 text-sm" />
                <select name="currency" defaultValue={s.currency} className="h-9 rounded-md border px-2 text-sm">{["CNY", "USD", "EUR", "SRD"].map((c) => <option key={c}>{c}</option>)}</select>
                <input name="supplier_sku" placeholder="Lev. SKU" className="h-9 w-28 rounded-md border px-2 text-sm" />
                <input name="supplier_url" placeholder="Link" className="h-9 w-40 rounded-md border px-2 text-sm" />
                <input name="min_order_qty" type="number" min="1" defaultValue={1} className="h-9 w-16 rounded-md border px-2 text-sm" aria-label="MOQ" />
                <input name="lead_time_days" type="number" min="0" placeholder="Dagen" className="h-9 w-20 rounded-md border px-2 text-sm" />
                <SubmitButton size="sm" variant="outline">Toevoegen</SubmitButton>
              </ActionForm>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
