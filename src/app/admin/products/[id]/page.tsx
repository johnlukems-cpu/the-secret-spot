import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { requirePermission, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatSRD } from "@/lib/money";
import { archiveProductAction, deleteImageAction, deleteVariantAction, saveProductAction, saveVariantAction, setImageOrderAction, uploadImageAction } from "../actions";

const dt = (v: string | null) => (v ? v.slice(0, 16) : "");

export default async function ProductEdit({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("products.manage");
  const { id } = await params;
  const isNew = id === "new";
  const supabase = await createClient();
  const [{ data: p }, { data: cats }, { data: suppliers }, { data: variants }, { data: images }, { data: stock }, { data: lastCalc }] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase.from("categories").select("id, name, parent_id").is("deleted_at", null).order("sort_order"),
    can(session, "suppliers.manage") || can(session, "supplier_costs.view") ? supabase.from("suppliers").select("id, name").is("deleted_at", null).order("name") : Promise.resolve({ data: [] }),
    isNew ? Promise.resolve({ data: [] }) : supabase.from("product_variants").select("*").eq("product_id", id).is("deleted_at", null).order("sort_order"),
    isNew ? Promise.resolve({ data: [] }) : supabase.from("product_images").select("*").eq("product_id", id).order("sort_order"),
    isNew ? Promise.resolve({ data: [] }) : supabase.from("variant_stock").select("variant_id, available_qty").eq("product_id", id),
    isNew || !can(session, "pricing.manage") ? Promise.resolve({ data: null }) : supabase.from("cost_calculations").select("landed_cost_srd, final_price_srd, actual_margin_pct, is_estimate, created_at").eq("product_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!isNew && !p) notFound();
  const parents = (cats ?? []).filter((c) => !c.parent_id);
  const stockMap = new Map((stock ?? []).map((s) => [s.variant_id, s.available_qty]));
  const specs = Object.entries((p?.specifications as Record<string, string>) ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");

  return (
    <div className="space-y-6">
      <PageHeader title={isNew ? "Nieuw product" : p!.title} description={isNew ? "Sla eerst de basisgegevens op; daarna voegt u varianten en foto's toe." : `SKU ${p!.sku}`}
        actions={!isNew && <>
          {p!.status === "active" && <Button asChild variant="outline" size="sm"><Link href={`/product/${p!.slug}`} target="_blank">Bekijk in winkel</Link></Button>}
          {can(session, "pricing.manage") && <Button asChild variant="outline" size="sm"><Link href={`/admin/pricing?product=${p!.id}`}>Prijs berekenen</Link></Button>}
        </>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Productgegevens</CardTitle></CardHeader>
          <CardContent>
            <ActionForm action={saveProductAction} className="grid gap-4 md:grid-cols-2">
              {!isNew && <input type="hidden" name="id" value={p!.id} />}
              <Field label="Titel *" className="md:col-span-2"><Input name="title" defaultValue={p?.title} required /></Field>
              <Field label="SKU *"><Input name="sku" defaultValue={p?.sku} required /></Field>
              <Field label="URL-slug" hint="Leeg = automatisch"><Input name="slug" defaultValue={p?.slug} /></Field>
              <Field label="Categorie">
                <Select name="category_id" defaultValue={p?.category_id ?? ""}>
                  <option value="">–</option>
                  {parents.map((pc) => (
                    <optgroup key={pc.id} label={pc.name}>
                      <option value={pc.id}>{pc.name} (algemeen)</option>
                      {(cats ?? []).filter((c) => c.parent_id === pc.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Field label="Merk"><Input name="brand" defaultValue={p?.brand ?? ""} /></Field>
              <Field label="Verkooptype *">
                <Select name="sales_type" defaultValue={p?.sales_type ?? "ready"}>
                  <option value="ready">Ready-to-order (voorraad in Suriname)</option>
                  <option value="preorder">Pre-order</option>
                  <option value="coming_soon">Binnenkort (niet bestelbaar)</option>
                </Select>
              </Field>
              <Field label="Status *">
                <Select name="status" defaultValue={p?.status ?? "draft"}><option value="draft">Concept</option><option value="active">Actief (zichtbaar)</option><option value="archived">Gearchiveerd</option></Select>
              </Field>
              <Field label="Verkoopprijs (SRD) *"><Input name="base_price" type="number" step="0.01" min="0" defaultValue={p?.base_price} required /></Field>
              <Field label="Promotieprijs (SRD)"><Input name="promo_price" type="number" step="0.01" min="0" defaultValue={p?.promo_price ?? ""} /></Field>
              <Field label="Promotie vanaf"><Input name="promo_starts_at" type="datetime-local" defaultValue={dt(p?.promo_starts_at ?? null)} /></Field>
              <Field label="Promotie tot"><Input name="promo_ends_at" type="datetime-local" defaultValue={dt(p?.promo_ends_at ?? null)} /></Field>
              <Field label="Aanbetaling % (pre-order, optioneel)" hint="Leeg = standaard uit instellingen"><Input name="deposit_percentage" type="number" step="0.01" min="0" max="100" defaultValue={p?.deposit_percentage ?? ""} /></Field>
              <Field label="Levertijd tekst"><Input name="estimated_delivery_text" defaultValue={p?.estimated_delivery_text ?? ""} placeholder="bijv. 4–6 weken na inkoop" /></Field>
              <Field label="Pre-order: min. dagen na inkoop"><Input name="preorder_lead_days_min" type="number" min="0" defaultValue={p?.preorder_lead_days_min ?? ""} /></Field>
              <Field label="Pre-order: max. dagen na inkoop"><Input name="preorder_lead_days_max" type="number" min="0" defaultValue={p?.preorder_lead_days_max ?? ""} /></Field>
              <Field label="Standaard leverancier">
                <Select name="default_supplier_id" defaultValue={p?.default_supplier_id ?? ""}><option value="">–</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              </Field>
              <Field label="Gewicht (kg) / volume (m³)">
                <div className="flex gap-2"><Input name="weight_kg" type="number" step="0.001" defaultValue={p?.weight_kg ?? ""} /><Input name="volume_m3" type="number" step="0.000001" defaultValue={p?.volume_m3 ?? ""} /></div>
              </Field>
              <Field label="Omschrijving" className="md:col-span-2"><Textarea name="description" rows={5} defaultValue={p?.description ?? ""} /></Field>
              <Field label="Specificaties (één per regel: Kenmerk: waarde)"><Textarea name="specifications" rows={4} defaultValue={specs} /></Field>
              <Field label="Maattabel"><Textarea name="size_guide" rows={4} defaultValue={p?.size_guide ?? ""} /></Field>
              <Field label="Tags (komma's)"><Input name="tags" defaultValue={(p?.tags ?? []).join(", ")} /></Field>
              <div className="flex flex-wrap items-end gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="is_featured" defaultChecked={p?.is_featured} /> Uitgelicht</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="is_new_arrival" defaultChecked={p?.is_new_arrival} /> Nieuw binnen</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="is_best_seller" defaultChecked={p?.is_best_seller} /> Best seller</label>
              </div>
              <Field label="SEO-titel"><Input name="seo_title" defaultValue={p?.seo_title ?? ""} /></Field>
              <Field label="SEO-omschrijving"><Input name="seo_description" defaultValue={p?.seo_description ?? ""} /></Field>
              <div className="md:col-span-2"><SubmitButton>{isNew ? "Product aanmaken" : "Opslaan"}</SubmitButton></div>
            </ActionForm>
          </CardContent>
        </Card>

        {!isNew && (
          <div className="space-y-6">
            {lastCalc && (
              <Card>
                <CardHeader><CardTitle>Laatste kostprijsberekening</CardTitle></CardHeader>
                <CardContent className="text-sm">
                  <p>Landed cost: {formatSRD(lastCalc.landed_cost_srd)} ({lastCalc.is_estimate ? "schatting" : "werkelijk"})</p>
                  <p>Marge bij huidige prijs: {Number(lastCalc.actual_margin_pct).toFixed(1)}%</p>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader><CardTitle>Foto&apos;s</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {(images ?? []).map((img) => (
                    <div key={img.id} className="space-y-1">
                      <div className="relative aspect-[3/4] bg-cream"><Image src={img.url} alt={img.alt ?? ""} fill sizes="120px" className="object-cover" /></div>
                      <ActionForm action={setImageOrderAction} className="flex gap-1">
                        <input type="hidden" name="id" value={img.id} /><input type="hidden" name="product_id" value={id} />
                        <input name="sort_order" type="number" defaultValue={img.sort_order} className="h-7 w-12 rounded border px-1 text-xs" aria-label="Volgorde" />
                        <button className="text-xs underline">ok</button>
                      </ActionForm>
                      <ActionForm action={deleteImageAction} confirm="Afbeelding verwijderen?"><input type="hidden" name="id" value={img.id} /><input type="hidden" name="product_id" value={id} /><button className="text-xs text-red-700 underline">verwijder</button></ActionForm>
                    </div>
                  ))}
                </div>
                <ActionForm action={uploadImageAction} className="space-y-2" reset>
                  <input type="hidden" name="product_id" value={id} />
                  <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required className="text-xs" />
                  <div className="flex gap-2"><Input name="alt" placeholder="Alt-tekst" className="h-9" /><Input name="color" placeholder="Kleur (opt.)" className="h-9" /></div>
                  <SubmitButton size="sm" variant="outline">Uploaden</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
            <ActionForm action={archiveProductAction} confirm="Product archiveren? Het verdwijnt uit de winkel; orderhistorie blijft bewaard.">
              <input type="hidden" name="id" value={id} /><SubmitButton variant="outline" size="sm">Archiveren</SubmitButton>
            </ActionForm>
          </div>
        )}
      </div>

      {!isNew && (
        <Card>
          <CardHeader><CardTitle>Varianten (maat / kleur)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-taupe">Voorraad beheert u in de module Voorraad. Leveranciersprijzen per variant beheert u bij Leveranciers.</p>
            {(variants ?? []).map((v) => (
              <div key={v.id} className="flex flex-wrap items-end gap-2 border-b pb-2">
                <ActionForm action={saveVariantAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={v.id} /><input type="hidden" name="product_id" value={id} />
                  <label className="text-xs">SKU<input name="sku" defaultValue={v.sku} className="block h-9 w-44 rounded-md border px-2 text-sm" /></label>
                  <label className="text-xs">Maat<input name="size" defaultValue={v.size ?? ""} className="block h-9 w-20 rounded-md border px-2 text-sm" /></label>
                  <label className="text-xs">Kleur<input name="color" defaultValue={v.color ?? ""} className="block h-9 w-28 rounded-md border px-2 text-sm" /></label>
                  <label className="text-xs">Hex<input name="color_hex" defaultValue={v.color_hex ?? ""} className="block h-9 w-24 rounded-md border px-2 text-sm" /></label>
                  <label className="text-xs">Afwijkende prijs<input name="price_override" type="number" step="0.01" defaultValue={v.price_override ?? ""} className="block h-9 w-28 rounded-md border px-2 text-sm" /></label>
                  <label className="text-xs">Volgorde<input name="sort_order" type="number" defaultValue={v.sort_order} className="block h-9 w-16 rounded-md border px-2 text-sm" /></label>
                  <label className="flex h-9 items-center gap-1 text-xs"><input type="checkbox" name="is_active" defaultChecked={v.is_active} /> actief</label>
                  <SubmitButton size="sm" variant="outline">Opslaan</SubmitButton>
                </ActionForm>
                <span className="h-9 px-2 text-xs leading-9 text-taupe">beschikbaar: {stockMap.get(v.id) ?? 0}</span>
                <ActionForm action={deleteVariantAction} confirm="Variant verwijderen?"><input type="hidden" name="id" value={v.id} /><input type="hidden" name="product_id" value={id} /><SubmitButton size="sm" variant="ghost">Verwijder</SubmitButton></ActionForm>
              </div>
            ))}
            <ActionForm action={saveVariantAction} className="flex flex-wrap items-end gap-2 pt-2" reset>
              <input type="hidden" name="product_id" value={id} />
              <label className="text-xs">SKU *<input name="sku" required defaultValue={`${p!.sku}-`} className="block h-9 w-44 rounded-md border px-2 text-sm" /></label>
              <label className="text-xs">Maat<input name="size" className="block h-9 w-20 rounded-md border px-2 text-sm" /></label>
              <label className="text-xs">Kleur<input name="color" className="block h-9 w-28 rounded-md border px-2 text-sm" /></label>
              <label className="text-xs">Hex<input name="color_hex" placeholder="#171A18" className="block h-9 w-24 rounded-md border px-2 text-sm" /></label>
              <label className="text-xs">Afwijkende prijs<input name="price_override" type="number" step="0.01" className="block h-9 w-28 rounded-md border px-2 text-sm" /></label>
              <input type="hidden" name="sort_order" value={(variants ?? []).length} />
              <SubmitButton size="sm">Variant toevoegen</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
