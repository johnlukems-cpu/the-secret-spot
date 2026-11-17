import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteCategoryAction, saveCategoryAction } from "./actions";

export const metadata = { title: "Categorieën" };

type Cat = { id: string; name: string; name_en: string | null; slug: string; parent_id: string | null; sort_order: number; is_active: boolean };

function Row({ c, parents }: { c: Cat; parents: Cat[] }) {
  return (
    <div className="flex flex-wrap items-end gap-2 py-2">
      <ActionForm action={saveCategoryAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={c.id} />
        <input name="name" defaultValue={c.name} className="h-9 w-40 rounded-md border px-2 text-sm" aria-label="Naam" />
        <input name="name_en" defaultValue={c.name_en ?? ""} placeholder="EN" className="h-9 w-32 rounded-md border px-2 text-sm" aria-label="Naam (EN)" />
        <input name="slug" defaultValue={c.slug} className="h-9 w-40 rounded-md border px-2 text-sm" aria-label="Slug" />
        <select name="parent_id" defaultValue={c.parent_id ?? ""} className="h-9 rounded-md border px-2 text-sm" aria-label="Bovenliggend">
          <option value="">(hoofdcategorie)</option>{parents.filter((p) => p.id !== c.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input name="sort_order" type="number" defaultValue={c.sort_order} className="h-9 w-16 rounded-md border px-2 text-sm" aria-label="Volgorde" />
        <label className="flex h-9 items-center gap-1 text-xs"><input type="checkbox" name="is_active" defaultChecked={c.is_active} /> actief</label>
        <SubmitButton size="sm" variant="outline">Opslaan</SubmitButton>
      </ActionForm>
      <ActionForm action={deleteCategoryAction} confirm="Categorie verwijderen?"><input type="hidden" name="id" value={c.id} /><SubmitButton size="sm" variant="ghost">Verwijder</SubmitButton></ActionForm>
    </div>
  );
}

export default async function CategoriesPage() {
  await requirePermission("categories.manage");
  const supabase = await createClient();
  const { data } = await supabase.from("categories").select("id, name, name_en, slug, parent_id, sort_order, is_active").is("deleted_at", null).order("sort_order");
  const all = (data ?? []) as Cat[];
  const parents = all.filter((c) => !c.parent_id);
  return (
    <div className="space-y-6">
      <PageHeader title="Categorieën" description="Hoofd- en subcategorieën van de winkel." />
      {parents.map((p) => (
        <Card key={p.id}>
          <CardHeader><CardTitle>{p.name}</CardTitle></CardHeader>
          <CardContent className="divide-y">
            <Row c={p} parents={parents} />
            <div className="pl-6">{all.filter((c) => c.parent_id === p.id).map((c) => <Row key={c.id} c={c} parents={parents} />)}</div>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader><CardTitle>Nieuwe categorie</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={saveCategoryAction} className="flex flex-wrap items-end gap-2" reset>
            <input name="name" required placeholder="Naam" className="h-9 w-48 rounded-md border px-2 text-sm" />
            <input name="name_en" placeholder="Naam (EN)" className="h-9 w-40 rounded-md border px-2 text-sm" />
            <select name="parent_id" className="h-9 rounded-md border px-2 text-sm"><option value="">(hoofdcategorie)</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <input name="sort_order" type="number" defaultValue={0} className="h-9 w-16 rounded-md border px-2 text-sm" />
            <SubmitButton size="sm">Toevoegen</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
