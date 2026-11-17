import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/components/store/gallery";
import { ProductPurchase } from "@/components/store/product-purchase";
import { ProductGrid, availabilityLabel } from "@/components/store/product-card";
import { Badge } from "@/components/ui/badge";
import { effectivePrice, getProductBySlug, getPublicSettings, listProducts } from "@/lib/data/catalog";
import { formatSRD } from "@/lib/money";
import { publicEnv } from "@/lib/env";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProductBySlug(slug);
  if (!p) return {};
  const description = p.seo_description ?? p.description?.slice(0, 155) ?? `${p.title} bij THE SECRET SPOT`;
  return {
    title: p.seo_title ?? p.title,
    description,
    alternates: { canonical: `/product/${p.slug}` },
    openGraph: { title: p.title, description, images: p.images.slice(0, 1).map((i) => ({ url: i.url })), type: "website" },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, settings] = await Promise.all([getProductBySlug(slug), getPublicSettings()]);
  if (!product) notFound();
  const { price, compareAt } = effectivePrice(product);
  const depositPct = Number(product.deposit_percentage ?? settings.deposit_preorder_pct ?? 0);
  const related = product.category_id ? await listProducts({ pageSize: 4, excludeId: product.id, category: product.category?.slug }) : { items: [] };
  const avail = availabilityLabel(product);
  const specs = Object.entries(product.specifications ?? {});

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    sku: product.sku,
    description: product.description ?? undefined,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    image: product.images.map((i) => (i.url.startsWith("http") ? i.url : `${publicEnv.siteUrl}${i.url}`)),
    offers: {
      "@type": "Offer",
      priceCurrency: "SRD",
      price: price.toFixed(2),
      url: `${publicEnv.siteUrl}/product/${product.slug}`,
      availability: product.sales_type === "preorder" ? "https://schema.org/PreOrder"
        : product.sales_type === "coming_soon" ? "https://schema.org/PreSale"
        : product.totalAvailable > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <div className="container py-6 md:py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav className="mb-6 text-xs text-taupe" aria-label="Kruimelpad">
        <Link href="/">Home</Link> / <Link href="/collectie">Collectie</Link>
        {product.category && <> / <Link href={`/collectie/${product.category.slug}`}>{product.category.name}</Link></>}
      </nav>
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-16 [&>*]:min-w-0">
        <Gallery images={product.images} title={product.title} />
        <div className="lg:sticky lg:top-28 lg:self-start">
          <div className="flex gap-2"><Badge variant={avail.variant}>{avail.label}</Badge>{compareAt && <Badge>Sale</Badge>}</div>
          {product.brand && <p className="eyebrow mt-4">{product.brand}</p>}
          <h1 className="mt-2 text-3xl md:text-4xl">{product.title}</h1>
          <p className="mt-1 text-xs text-taupe">Art.nr. {product.sku}</p>
          <p className="mt-4 text-xl">
            {formatSRD(price)}
            {compareAt && <span className="ml-3 text-base text-taupe line-through">{formatSRD(compareAt)}</span>}
          </p>
          <div className="mt-6"><ProductPurchase product={product} price={price} depositPct={depositPct} /></div>
          {product.description && (
            <div className="mt-8 border-t pt-6">
              <h2 className="eyebrow mb-3">Beschrijving</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed">{product.description}</p>
            </div>
          )}
          {specs.length > 0 && (
            <div className="mt-6 border-t pt-6">
              <h2 className="eyebrow mb-3">Specificaties</h2>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                {specs.map(([k, v]) => <div key={k} className="contents"><dt className="text-taupe">{k}</dt><dd>{String(v)}</dd></div>)}
              </dl>
            </div>
          )}
          {product.size_guide && (
            <div id="maattabel" className="mt-6 border-t pt-6">
              <h2 className="eyebrow mb-3">Maattabel</h2>
              <p className="whitespace-pre-line text-sm">{product.size_guide}</p>
            </div>
          )}
        </div>
      </div>
      {related.items.length > 0 && (
        <section className="mt-20">
          <h2 className="mb-8 text-3xl">Misschien ook iets voor u</h2>
          <ProductGrid products={related.items} />
        </section>
      )}
    </div>
  );
}
