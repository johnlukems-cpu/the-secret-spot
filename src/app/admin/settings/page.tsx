import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { savePricingSettingsAction, saveSettingsAction, saveZoneAction } from "./actions";
import { SETTING_DEFS } from "./defs";

export const metadata = { title: "Bedrijfsinstellingen" };
type Z = { id: string; name: string; parent_id: string | null; fee: string; promo_fee: string | null; promo_ends_at: string | null; free_threshold: string | null; estimated_days: string | null; sort_order: number; is_active: boolean };

function ZoneForm({ z, parents }: { z?: Z; parents: Z[] }) {
  return (
    <ActionForm action={saveZoneAction} className="flex flex-wrap items-end gap-2 border-b py-2 text-sm" reset={!z}>
      {z && <input type="hidden" name="id" value={z.id} />}
      <label className="text-xs">Naam<input name="name" required defaultValue={z?.name} className="block h-9 w-36 rounded-md border px-2" /></label>
      <label className="text-xs">Onderdeel van<select name="parent_id" defaultValue={z?.parent_id ?? ""} className="block h-9 rounded-md border px-2"><option value="">(district)</option>{parents.filter((p) => p.id !== z?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="text-xs">Tarief SRD<input name="fee" type="number" step="0.01" min="0" required defaultValue={z?.fee ?? 0} className="block h-9 w-24 rounded-md border px-2" /></label>
      <label className="text-xs">Actietarief<input name="promo_fee" type="number" step="0.01" min="0" defaultValue={z?.promo_fee ?? ""} className="block h-9 w-24 rounded-md border px-2" /></label>
      <label className="text-xs">Actie tot<input name="promo_ends_at" type="datetime-local" defaultValue={z?.promo_ends_at?.slice(0, 16) ?? ""} className="block h-9 rounded-md border px-2" /></label>
      <label className="text-xs">Gratis vanaf<input name="free_threshold" type="number" step="0.01" min="0" defaultValue={z?.free_threshold ?? ""} className="block h-9 w-24 rounded-md border px-2" /></label>
      <label className="text-xs">Levertijd<input name="estimated_days" defaultValue={z?.estimated_days ?? ""} className="block h-9 w-28 rounded-md border px-2" /></label>
      <label className="text-xs">Volgorde<input name="sort_order" type="number" defaultValue={z?.sort_order ?? 0} className="block h-9 w-16 rounded-md border px-2" /></label>
      {z && <label className="flex h-9 items-center gap-1 text-xs"><input type="checkbox" name="is_active" defaultChecked={z.is_active} /> actief</label>}
      <SubmitButton size="sm" variant={z ? "outline" : "default"}>{z ? "Opslaan" : "Toevoegen"}</SubmitButton>
    </ActionForm>
  );
}

export default async function SettingsPage() {
  const session = await requirePermission("settings.manage");
  const supabase = await createClient();
  const [{ data: settings }, { data: zones }, { data: pricing }] = await Promise.all([
    supabase.from("business_settings").select("key, value"),
    supabase.from("delivery_zones").select("*").order("sort_order"),
    supabase.from("pricing_settings").select("*").eq("is_default", true).maybeSingle(),
  ]);
  const val = (k: string) => (settings ?? []).find((s) => s.key === k)?.value;
  const groups = [...new Set(Object.values(SETTING_DEFS).map((d) => d.group))];
  const allZones = (zones ?? []) as Z[];
  return (
    <div className="space-y-6">
      <PageHeader title="Bedrijfsinstellingen" description="Alle percentages, termijnen en tarieven zijn hier instelbaar; niets is hard gecodeerd. Wijzigingen worden in het audit log vastgelegd. Bestaande bestellingen behouden hun berekende bedragen." />
      <ActionForm action={saveSettingsAction} className="space-y-6">
        {groups.map((g) => (
          <Card key={g}>
            <CardHeader><CardTitle>{g}</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {Object.entries(SETTING_DEFS).filter(([, d]) => d.group === g).map(([k, d]) => (
                <label key={k} className={`text-sm ${d.type === "longtext" ? "md:col-span-2" : ""}`}>
                  {d.type === "boolean" ? (
                    <span className="flex items-center gap-2"><input type="hidden" name={`present_${k}`} value="1" /><input type="checkbox" name={`s_${k}`} defaultChecked={val(k) === true} /> {d.label}</span>
                  ) : (
                    <>
                      {d.label}
                      {d.type === "longtext"
                        ? <textarea name={`s_${k}`} defaultValue={String(val(k) ?? "")} rows={4} className="mt-1 block w-full rounded-md border p-2" />
                        : <input name={`s_${k}`} type={d.type === "number" ? "number" : "text"} step="any" min={d.min} max={d.max} defaultValue={String(val(k) ?? "")} className="mt-1 block h-9 w-full rounded-md border px-2" />}
                    </>
                  )}
                </label>
              ))}
            </CardContent>
          </Card>
        ))}
        <SubmitButton>Instellingen opslaan</SubmitButton>
      </ActionForm>

      <Card>
        <CardHeader><CardTitle>Bezorgzones & tarieven</CardTitle></CardHeader>
        <CardContent>
          {allZones.map((z) => <ZoneForm key={z.id} z={z} parents={allZones.filter((p) => !p.parent_id)} />)}
          <div className="pt-3"><p className="mb-1 text-xs font-semibold">Nieuwe zone of deelgebied</p><ZoneForm parents={allZones.filter((p) => !p.parent_id)} /></div>
        </CardContent>
      </Card>

      {pricing && can(session, "pricing.manage") && (
        <Card>
          <CardHeader><CardTitle>Standaard prijsinstellingen (calculator)</CardTitle></CardHeader>
          <CardContent>
            <ActionForm action={savePricingSettingsAction} className="grid gap-2 text-sm md:grid-cols-4">
              <input type="hidden" name="id" value={pricing.id} />
              {([["target_margin_pct", "Doelmarge %"], ["customs_duty_pct", "Invoerrechten %"], ["import_tax_pct", "Importbelasting %"], ["packaging_per_unit_srd", "Verpakking/stuk"], ["clearance_per_unit_srd", "Inklaring/stuk"], ["local_transport_per_unit_srd", "Lokaal transport/stuk"], ["rounding_step", "Afronden op SRD"]] as const).map(([k, l]) => (
                <label key={k}>{l}<input name={k} type="number" step="any" min="0" defaultValue={pricing[k]} className="block h-9 w-full rounded-md border px-2" /></label>
              ))}
              <label className="md:col-span-4">Notities<textarea name="notes" defaultValue={pricing.notes ?? ""} className="block w-full rounded-md border p-2" rows={2} /></label>
              <div><SubmitButton size="sm" variant="outline">Opslaan</SubmitButton></div>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
