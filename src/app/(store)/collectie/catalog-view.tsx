import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { ProductGrid } from "@/components/store/product-card";
import { Button } from "@/components/ui/button";
import { getCategoryTree, getFacets, listProducts, type ProductQuery } from "@/lib/data/catalog";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export function parseQuery(sp: SP, category?: string): ProductQuery {
  const num = (v?: string) => (v ? Number(v) : undefined);
  return {
    category,
    q: one(sp.q),
    size: one(sp.size),
    color: one(sp.color),
    min: num(one(sp.min)),
    max: num(one(sp.max)),
    type: one(sp.type) as ProductQuery["type"],
    sort: (one(sp.sort) as ProductQuery["sort"]) ?? "newest",
    flag: one(sp.flag) as ProductQuery["flag"],
    page: Number(one(sp.page) ?? 1) || 1,
    pageSize: 24,
  };
}

export async function CatalogView({ searchParams, category }: { searchParams: SP; category?: string }) {
  const q = parseQuery(searchParams, category);
  const [result, tree, facets] = await Promise.all([listProducts(q), getCategoryTree(), getFacets()]);
  const root = tree.find((c) => c.slug === category);
  const parent = tree.find((c) => c.children?.some((s) => s.slug === category));
  const current = root ?? parent?.children?.find((s) => s.slug === category);
  const subcats = root?.children ?? parent?.children ?? [];
  const title = q.q ? `Zoekresultaten voor “${q.q}”` : current?.name ?? (q.type === "preorder" ? "Pre-Order Collectie" : q.flag === "new" ? "Nieuw binnen" : q.flag === "best" ? "Best Sellers" : q.type === "in_stock" ? "Direct leverbaar" : "Alle producten");
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const base = category ? `/collectie/${category}` : "/collectie";
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([k, v]) => { const val = one(v); if (val && k !== "page") params.set(k, val); });
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `${base}?${s}` : base;
  };

  const filters = (
    <form method="get" action={base} className="space-y-6 text-sm">
      {q.q && <input type="hidden" name="q" value={q.q} />}
      {q.flag && <input type="hidden" name="flag" value={q.flag} />}
      <div>
        <label className="eyebrow mb-2 block" htmlFor="f-type">Beschikbaarheid</label>
        <select id="f-type" name="type" defaultValue={q.type ?? ""} className="h-10 w-full rounded-md border px-2">
          <option value="">Alles</option>
          <option value="in_stock">Direct leverbaar (op voorraad)</option>
          <option value="ready">Ready-to-order</option>
          <option value="preorder">Pre-order</option>
          <option value="coming_soon">Binnenkort</option>
        </select>
      </div>
      {facets.sizes.length > 0 && (
        <div>
          <label className="eyebrow mb-2 block" htmlFor="f-size">Maat</label>
          <select id="f-size" name="size" defaultValue={q.size ?? ""} className="h-10 w-full rounded-md border px-2">
            <option value="">Alle maten</option>
            {facets.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
      {facets.colors.length > 0 && (
        <div>
          <label className="eyebrow mb-2 block" htmlFor="f-color">Kleur</label>
          <select id="f-color" name="color" defaultValue={q.color ?? ""} className="h-10 w-full rounded-md border px-2">
            <option value="">Alle kleuren</option>
            {facets.colors.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <span className="eyebrow mb-2 block">Prijs (SRD)</span>
        <div className="flex gap-2">
          <input aria-label="Minimumprijs" name="min" type="number" min={0} inputMode="numeric" defaultValue={q.min} placeholder="Min" className="h-10 w-full rounded-md border px-2" />
          <input aria-label="Maximumprijs" name="max" type="number" min={0} inputMode="numeric" defaultValue={q.max} placeholder="Max" className="h-10 w-full rounded-md border px-2" />
        </div>
      </div>
      <div>
        <label className="eyebrow mb-2 block" htmlFor="f-sort">Sorteren</label>
        <select id="f-sort" name="sort" defaultValue={q.sort} className="h-10 w-full rounded-md border px-2">
          <option value="newest">Nieuwste</option>
          <option value="popular">Populair</option>
          <option value="price_asc">Prijs laag – hoog</option>
          <option value="price_desc">Prijs hoog – laag</option>
        </select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1">Toepassen</Button>
        <Button asChild variant="outline"><Link href={base}>Wissen</Link></Button>
      </div>
    </form>
  );

  return (
    <div className="container py-8 md:py-12">
      <nav className="mb-4 text-xs text-taupe" aria-label="Kruimelpad">
        <Link href="/">Home</Link> / <Link href="/collectie">Collectie</Link>
        {parent && <> / <Link href={`/collectie/${parent.slug}`}>{parent.name}</Link></>}
        {current && <> / <span className="text-charcoal">{current.name}</span></>}
      </nav>
      <h1 className="text-4xl md:text-5xl">{title}</h1>
      <p className="mt-2 text-sm text-taupe">{result.total} {result.total === 1 ? "product" : "producten"}</p>
      {subcats.length > 0 && (
        <div className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-2">
          {subcats.map((s) => (
            <Link key={s.id} href={`/collectie/${s.slug}`} className={`shrink-0 rounded-full border px-4 py-1.5 text-xs ${s.slug === category ? "border-charcoal bg-charcoal text-cream" : "hover:border-charcoal"}`}>{s.name}</Link>
          ))}
        </div>
      )}
      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr] [&>*]:min-w-0">
        <aside>
          <details className="rounded-md border p-4 lg:hidden">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><SlidersHorizontal className="h-4 w-4" /> Filters & sorteren</summary>
            <div className="mt-4">{filters}</div>
          </details>
          <div className="sticky top-28 hidden lg:block">{filters}</div>
        </aside>
        <div>
          {result.items.length ? (
            <ProductGrid products={result.items} priorityCount={4} />
          ) : (
            <div className="border border-dashed p-12 text-center">
              <p className="font-display text-2xl">Geen producten gevonden</p>
              <p className="mt-2 text-sm text-taupe">Pas uw filters aan of bekijk de volledige collectie.</p>
              <Button asChild variant="outline" className="mt-6"><Link href="/collectie">Alle producten</Link></Button>
            </div>
          )}
          {pages > 1 && (
            <nav className="mt-12 flex items-center justify-center gap-2" aria-label="Paginering">
              {result.page > 1 && <Button asChild variant="outline" size="sm"><Link href={pageHref(result.page - 1)}>Vorige</Link></Button>}
              <span className="px-3 text-sm text-taupe">Pagina {result.page} van {pages}</span>
              {result.page < pages && <Button asChild variant="outline" size="sm"><Link href={pageHref(result.page + 1)}>Volgende</Link></Button>}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
