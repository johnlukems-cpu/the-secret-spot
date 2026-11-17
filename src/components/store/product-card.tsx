import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatSRD } from "@/lib/money";
import { effectivePrice } from "@/lib/data/price";
import type { ProductCard as P } from "@/lib/types";

export function availabilityLabel(p: Pick<P, "sales_type" | "totalAvailable">): { label: string; variant: "success" | "gold" | "outline" | "danger" } {
  if (p.sales_type === "coming_soon") return { label: "Binnenkort", variant: "outline" };
  if (p.sales_type === "preorder") return { label: "Pre-order", variant: "gold" };
  return p.totalAvailable > 0 ? { label: "Op voorraad", variant: "success" } : { label: "Uitverkocht", variant: "danger" };
}

export function ProductCard({ product, priority = false }: { product: P; priority?: boolean }) {
  const { price, compareAt } = effectivePrice(product);
  const img = product.images[0];
  const avail = availabilityLabel(product);
  return (
    <Link href={`/product/${product.slug}`} className="group block animate-fade-up">
      <div className="relative aspect-[3/4] overflow-hidden bg-cream">
        {img ? (
          <Image src={img.url} alt={img.alt ?? product.title} fill priority={priority}
                 sizes="(min-width:1024px) 25vw, (min-width:640px) 33vw, 50vw"
                 className="object-cover transition duration-700 group-hover:scale-[1.03]" />
        ) : <div className="flex h-full items-center justify-center text-xs text-taupe">Geen afbeelding</div>}
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          <Badge variant={avail.variant}>{avail.label}</Badge>
          {compareAt && <Badge variant="default">Sale</Badge>}
          {product.is_new_arrival && <Badge variant="cream">Nieuw</Badge>}
        </div>
      </div>
      <div className="mt-3 space-y-1">
        {product.brand && <p className="eyebrow">{product.brand}</p>}
        <h3 className="line-clamp-2 font-sans text-sm text-charcoal">{product.title}</h3>
        <p className="text-sm">
          <span className="font-medium">{formatSRD(price)}</span>
          {compareAt && <span className="ml-2 text-taupe line-through">{formatSRD(compareAt)}</span>}
        </p>
      </div>
    </Link>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: P[]; priorityCount?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
      {products.map((p, i) => <ProductCard key={p.id} product={p} priority={i < priorityCount} />)}
    </div>
  );
}
