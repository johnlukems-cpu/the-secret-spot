import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/money";
import { deleteBlockAction, saveBlockAction, saveReviewAction } from "./actions";

export const metadata = { title: "Website content" };
type B = Record<string, string | number | boolean | null> & { id?: string };
const types: Record<string, string> = { announcement: "Aankondigingsbalk", hero: "Hero banner", promo_banner: "Promobanner", page: "Infopagina (/info/<key>)", section: "Sectie" };

function BlockForm({ b }: { b?: B }) {
  const v = (k: string) => (b?.[k] ?? "") as string;
  return (
    <div className="rounded-lg border bg-white p-3">
      <ActionForm action={saveBlockAction} className="grid gap-2 text-sm md:grid-cols-4" reset={!b}>
        {b?.id && <input type="hidden" name="id" value={b.id} />}
        <select name="block_type" defaultValue={v("block_type") || "promo_banner"} className="h-9 rounded-md border px-2">{Object.entries(types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input name="key" defaultValue={v("key")} placeholder="Key / slug" className="h-9 rounded-md border px-2" />
        <input name="title" defaultValue={v("title")} placeholder="Titel" className="h-9 rounded-md border px-2 md:col-span-2" />
        <input name="subtitle" defaultValue={v("subtitle")} placeholder="Subtitel" className="h-9 rounded-md border px-2 md:col-span-2" />
        <input name="image_url" defaultValue={v("image_url")} placeholder="Afbeelding URL (https:// of /)" className="h-9 rounded-md border px-2" />
        <input name="link_url" defaultValue={v("link_url")} placeholder="Link (bijv. /collectie)" className="h-9 rounded-md border px-2" />
        <input name="cta_label" defaultValue={v("cta_label")} placeholder="Knoptekst" className="h-9 rounded-md border px-2" />
        <input name="sort_order" type="number" defaultValue={v("sort_order") || 0} className="h-9 rounded-md border px-2" aria-label="Volgorde" />
        <input name="starts_at" type="datetime-local" defaultValue={String(v("starts_at")).slice(0, 16)} className="h-9 rounded-md border px-2" aria-label="Vanaf" />
        <input name="ends_at" type="datetime-local" defaultValue={String(v("ends_at")).slice(0, 16)} className="h-9 rounded-md border px-2" aria-label="Tot" />
        <textarea name="body" defaultValue={v("body")} placeholder="Tekst (voor infopagina's)" rows={2} className="rounded-md border p-2 md:col-span-4" />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="is_active" defaultChecked={b ? Boolean(b.is_active) : true} /> actief</label>
        <div><SubmitButton size="sm" variant={b ? "outline" : "default"}>{b ? "Opslaan" : "Blok toevoegen"}</SubmitButton></div>
      </ActionForm>
      {b?.id && <ActionForm action={deleteBlockAction} confirm="Blok verwijderen?" className="mt-1"><input type="hidden" name="id" value={b.id} /><button className="text-xs text-red-700 underline">verwijderen</button></ActionForm>}
    </div>
  );
}

export default async function ContentPage() {
  await requirePermission("content.manage");
  const supabase = await createClient();
  const [{ data: blocks }, { data: reviews }, { data: subs, count }] = await Promise.all([
    supabase.from("site_content").select("*").order("block_type").order("sort_order"),
    supabase.from("reviews").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("newsletter_subscribers").select("email, consent_at, unsubscribed_at", { count: "exact" }).is("unsubscribed_at", null).order("consent_at", { ascending: false }).limit(50),
  ]);
  return (
    <div className="space-y-8">
      <PageHeader title="Website content" description="Beheer homepage-banners, aankondigingen en infopagina's zonder code. Uitgelichte producten / nieuw / best sellers stelt u per product in." />
      <section className="space-y-3"><h2 className="text-sm font-semibold">Nieuw blok</h2><BlockForm /></section>
      {Object.keys(types).map((t) => {
        const list = (blocks ?? []).filter((b) => b.block_type === t);
        return list.length ? <section key={t} className="space-y-2"><h2 className="text-sm font-semibold">{types[t]}</h2>{list.map((b) => <BlockForm key={b.id} b={b} />)}</section> : null;
      })}
      <Card>
        <CardHeader><CardTitle>Klantreviews</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-taupe">Publiceer alleen echte reviews met toestemming van de klant.</p>
          <ActionForm action={saveReviewAction} className="flex flex-wrap items-end gap-2 text-sm" reset>
            <input name="author_name" required placeholder="Naam" className="h-9 w-36 rounded-md border px-2" />
            <input name="rating" type="number" min={1} max={5} defaultValue={5} className="h-9 w-16 rounded-md border px-2" aria-label="Score" />
            <input name="body" required placeholder="Review" className="h-9 flex-1 rounded-md border px-2" />
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="is_published" /> publiceren</label>
            <SubmitButton size="sm">Toevoegen</SubmitButton>
          </ActionForm>
          {(reviews ?? []).map((r) => (
            <ActionForm key={r.id} action={saveReviewAction} className="flex flex-wrap items-end gap-2 border-t pt-2 text-sm">
              <input type="hidden" name="id" value={r.id} />
              <input name="author_name" defaultValue={r.author_name} className="h-9 w-36 rounded-md border px-2" />
              <input name="rating" type="number" min={1} max={5} defaultValue={r.rating} className="h-9 w-16 rounded-md border px-2" />
              <input name="body" defaultValue={r.body} className="h-9 flex-1 rounded-md border px-2" />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="is_published" defaultChecked={r.is_published} /> gepubliceerd</label>
              <SubmitButton size="sm" variant="outline">Opslaan</SubmitButton>
            </ActionForm>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between"><CardTitle>Nieuwsbrief ({count ?? 0} actieve aanmeldingen)</CardTitle><a href={"/api/admin/export/newsletter"} className="text-xs underline">CSV</a></CardHeader>
        <CardContent><ul className="text-sm">{(subs ?? []).map((s) => <li key={s.email}>{s.email} <span className="text-xs text-taupe">{formatDate(s.consent_at)}</span></li>)}</ul></CardContent>
      </Card>
    </div>
  );
}
