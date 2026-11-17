import Link from "next/link";
import Image from "next/image";
import { PageHeader } from "@/components/admin/page-header";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatSRD } from "@/lib/money";

export const metadata = { title: "Producten" };
const PAGE = 40;

export default async function ProductsAdmin({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; type?: string; page?: string }> }) {
  await requirePermission("products.manage");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createClient();
  let q = supabase.from("products").select("id, sku, title, sales_type, status, base_price, promo_price, product_images(url, sort_order), product_variants(id), categories(name)", { count: "exact" }).is("deleted_at", null);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.type) q = q.eq("sales_type", sp.type);
  if (sp.q) { const t = sp.q.replace(/[%,()]/g, ""); q = q.or(`title.ilike.%${t}%,sku.ilike.%${t}%`); }
  const { data, count } = await q.order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const ids = (data ?? []).map((p) => p.id);
  const { data: stock } = ids.length ? await supabase.from("variant_stock").select("product_id, available_qty").in("product_id", ids) : { data: [] };
  const avail = new Map<string, number>();
  (stock ?? []).forEach((s) => avail.set(s.product_id, (avail.get(s.product_id) ?? 0) + s.available_qty));
  return (
    <div>
      <PageHeader title="Producten" description={`${count ?? 0} producten`} actions={<Button asChild size="sm"><Link href="/admin/products/new">Nieuw product</Link></Button>} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Zoek titel of SKU" className="h-9 w-56 rounded-md border px-3 text-sm" />
        <select name="status" defaultValue={sp.status ?? ""} className="h-9 rounded-md border px-2 text-sm"><option value="">Alle statussen</option><option value="active">Actief</option><option value="draft">Concept</option><option value="archived">Gearchiveerd</option></select>
        <select name="type" defaultValue={sp.type ?? ""} className="h-9 rounded-md border px-2 text-sm"><option value="">Alle typen</option><option value="ready">Ready</option><option value="preorder">Pre-order</option><option value="coming_soon">Binnenkort</option></select>
        <Button size="sm">Filter</Button>
      </form>
      <Table>
        <THead><TR><TH></TH><TH>Product</TH><TH>Categorie</TH><TH>Type</TH><TH>Status</TH><TH className="text-right">Prijs</TH><TH className="text-right">Beschikbaar</TH></TR></THead>
        <TBody>
          {(data ?? []).length === 0 && <EmptyRow cols={7}>Geen producten.</EmptyRow>}
          {(data ?? []).map((p) => {
            const img = [...(p.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0];
            return (
              <TR key={p.id}>
                <TD className="w-12">{img && <Image src={img.url} alt="" width={40} height={52} className="h-[52px] w-10 object-cover" />}</TD>
                <TD><Link href={`/admin/products/${p.id}`} className="font-medium hover:underline">{p.title}</Link><div className="text-xs text-taupe">{p.sku} · {p.product_variants?.length ?? 0} varianten</div></TD>
                <TD>{(p.categories as unknown as { name: string } | null)?.name ?? "–"}</TD>
                <TD>{p.sales_type === "ready" ? "Ready" : p.sales_type === "preorder" ? "Pre-order" : "Binnenkort"}</TD>
                <TD><Badge variant={p.status === "active" ? "success" : p.status === "draft" ? "outline" : "danger"}>{p.status}</Badge></TD>
                <TD className="text-right tabular-nums">{formatSRD(p.promo_price ?? p.base_price)}{p.promo_price && <div className="text-xs text-taupe line-through">{formatSRD(p.base_price)}</div>}</TD>
                <TD className="text-right">{p.sales_type === "ready" ? avail.get(p.id) ?? 0 : "–"}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      {(count ?? 0) > PAGE && (
        <div className="mt-4 flex gap-3 text-sm">
          {page > 1 && <Link className="underline" href={`?page=${page - 1}`}>Vorige</Link>}
          <span>Pagina {page}</span>
          {page * PAGE < (count ?? 0) && <Link className="underline" href={`?page=${page + 1}`}>Volgende</Link>}
        </div>
      )}
    </div>
  );
}
