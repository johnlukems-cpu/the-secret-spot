import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { savePromotionAction } from "./actions";

export const metadata = { title: "Promoties" };
type P = { id?: string; code?: string | null; name?: string; discount_type?: string; discount_value?: string; min_order_amount?: string; category_id?: string | null; starts_at?: string | null; ends_at?: string | null; usage_limit?: number | null; used_count?: number; is_active?: boolean };

function PromoForm({ p, cats }: { p?: P; cats: { id: string; name: string }[] }) {
  return (
    <ActionForm action={savePromotionAction} className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3 text-sm" reset={!p}>
      {p?.id && <input type="hidden" name="id" value={p.id} />}
      <label className="text-xs">Naam<input name="name" required defaultValue={p?.name} className="block h-9 w-44 rounded-md border px-2" /></label>
      <label className="text-xs">Code<input name="code" defaultValue={p?.code ?? ""} className="block h-9 w-28 rounded-md border px-2 uppercase" /></label>
      <label className="text-xs">Type<select name="discount_type" defaultValue={p?.discount_type ?? "percentage"} className="block h-9 rounded-md border px-2"><option value="percentage">%</option><option value="fixed">Vast bedrag</option><option value="free_delivery">Gratis bezorging</option></select></label>
      <label className="text-xs">Waarde<input name="discount_value" type="number" step="0.01" defaultValue={p?.discount_value ?? 0} className="block h-9 w-24 rounded-md border px-2" /></label>
      <label className="text-xs">Min. bestelling<input name="min_order_amount" type="number" step="0.01" defaultValue={p?.min_order_amount ?? 0} className="block h-9 w-24 rounded-md border px-2" /></label>
      <label className="text-xs">Categorie<select name="category_id" defaultValue={p?.category_id ?? ""} className="block h-9 rounded-md border px-2"><option value="">Alle</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="text-xs">Vanaf<input name="starts_at" type="datetime-local" defaultValue={p?.starts_at?.slice(0, 16) ?? ""} className="block h-9 rounded-md border px-2" /></label>
      <label className="text-xs">Tot<input name="ends_at" type="datetime-local" defaultValue={p?.ends_at?.slice(0, 16) ?? ""} className="block h-9 rounded-md border px-2" /></label>
      <label className="text-xs">Max. gebruik<input name="usage_limit" type="number" min="1" defaultValue={p?.usage_limit ?? ""} className="block h-9 w-20 rounded-md border px-2" /></label>
      <label className="flex h-9 items-center gap-1 text-xs"><input type="checkbox" name="is_active" defaultChecked={p?.is_active ?? true} /> actief</label>
      {p?.id && <span className="h-9 text-xs leading-9 text-taupe">gebruikt: {p.used_count}</span>}
      <SubmitButton size="sm" variant={p ? "outline" : "default"}>{p ? "Opslaan" : "Toevoegen"}</SubmitButton>
    </ActionForm>
  );
}

export default async function PromotionsPage() {
  await requirePermission("promotions.manage");
  const supabase = await createClient();
  const [{ data }, { data: cats }] = await Promise.all([
    supabase.from("promotions").select("*").order("created_at", { ascending: false }),
    supabase.from("categories").select("id, name").is("deleted_at", null).is("parent_id", null),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Promoties & kortingscodes" description="Kortingen worden server-side berekend en proportioneel over de in aanmerking komende regels verdeeld. Productpromoties (actieprijzen) stelt u in bij het product." />
      <PromoForm cats={cats ?? []} />
      {(data ?? []).map((p) => <PromoForm key={p.id} p={p} cats={cats ?? []} />)}
    </div>
  );
}
