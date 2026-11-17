import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import type { Category, ProductCard, ProductDetail, Variant } from "@/lib/types";

const PRODUCT_FIELDS =
  "id, slug, title, brand, sales_type, base_price, promo_price, promo_starts_at, promo_ends_at, estimated_delivery_text, is_new_arrival, is_best_seller, is_featured, category_id, product_images(id, url, alt, color, sort_order), product_variants(id, sku, size, color, color_hex, price_override, is_active, sort_order, deleted_at)";

export { effectivePrice } from "./price";

type RawProduct = Omit<ProductCard, "images" | "variants" | "totalAvailable"> & {
  product_images: ProductCard["images"];
  product_variants: (Omit<Variant, "available"> & { deleted_at: string | null })[];
};

async function stockFor(productIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!productIds.length) return map;
  const supabase = await createClient();
  const { data } = await supabase.from("variant_stock").select("variant_id, available_qty").in("product_id", productIds);
  (data ?? []).forEach((r: { variant_id: string; available_qty: number }) => map.set(r.variant_id, r.available_qty));
  return map;
}

function shape(rows: RawProduct[], stock: Map<string, number>): ProductCard[] {
  return rows.map(({ product_images, product_variants, ...p }) => {
    const variants = (product_variants ?? [])
      .filter((v) => !v.deleted_at && v.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ deleted_at: _d, ...v }) => ({ ...v, available: stock.get(v.id) ?? 0 }));
    return {
      ...p,
      images: [...(product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order),
      variants,
      totalAvailable: variants.reduce((s, v) => s + v.available, 0),
    };
  });
}

export const getPublicSettings = cache(async (): Promise<Record<string, unknown>> => {
  if (!isSupabaseConfigured()) return {};
  const supabase = await createClient();
  const { data } = await supabase.from("business_settings").select("key, value").eq("is_public", true);
  return Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
});

export const getCategoryTree = cache(async (): Promise<Category[]> => {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("categories").select("id, parent_id, name, slug, sort_order").is("deleted_at", null).eq("is_active", true).order("sort_order");
  const all = (data ?? []) as Category[];
  const roots = all.filter((c) => !c.parent_id);
  return roots.map((r) => ({ ...r, children: all.filter((c) => c.parent_id === r.id) }));
});

export interface ProductQuery {
  category?: string; q?: string; size?: string; color?: string; min?: number; max?: number;
  type?: "ready" | "preorder" | "coming_soon" | "in_stock"; sort?: "newest" | "price_asc" | "price_desc" | "popular";
  page?: number; pageSize?: number; flag?: "new" | "best" | "featured"; excludeId?: string;
}

export async function listProducts(q: ProductQuery): Promise<{ items: ProductCard[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(48, q.pageSize ?? 24);
  if (!isSupabaseConfigured()) return { items: [], total: 0, page, pageSize };
  const supabase = await createClient();

  const needsVariantFilter = Boolean(q.size || q.color);
  const fields = needsVariantFilter ? PRODUCT_FIELDS.replace("product_variants(", "product_variants!inner(") : PRODUCT_FIELDS;
  let query = supabase.from("products").select(fields, { count: "exact" }).eq("status", "active").is("deleted_at", null);

  if (q.category) {
    const tree = await getCategoryTree();
    const root = tree.find((c) => c.slug === q.category);
    const child = tree.flatMap((c) => c.children ?? []).find((c) => c.slug === q.category);
    const ids = root ? [root.id, ...(root.children ?? []).map((c) => c.id)] : child ? [child.id] : [];
    query = query.in("category_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  if (q.q) {
    const term = q.q.replace(/[%,()]/g, " ").trim().slice(0, 60);
    if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%,brand.ilike.%${term}%,sku.ilike.%${term}%`);
  }
  if (q.size) query = query.eq("product_variants.size", q.size);
  if (q.color) query = query.eq("product_variants.color", q.color);
  if (q.min != null && !Number.isNaN(q.min)) query = query.gte("base_price", q.min);
  if (q.max != null && !Number.isNaN(q.max)) query = query.lte("base_price", q.max);
  if (q.type === "ready" || q.type === "preorder" || q.type === "coming_soon") query = query.eq("sales_type", q.type);
  if (q.type === "in_stock") {
    const { data: inStock } = await supabase.from("variant_stock").select("product_id").gt("available_qty", 0);
    const ids = [...new Set((inStock ?? []).map((r: { product_id: string }) => r.product_id))];
    query = query.eq("sales_type", "ready").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  if (q.flag === "new") query = query.eq("is_new_arrival", true);
  if (q.flag === "best") query = query.eq("is_best_seller", true);
  if (q.flag === "featured") query = query.eq("is_featured", true);
  if (q.excludeId) query = query.neq("id", q.excludeId);

  switch (q.sort) {
    case "price_asc": query = query.order("base_price", { ascending: true }); break;
    case "price_desc": query = query.order("base_price", { ascending: false }); break;
    case "popular": query = query.order("popularity_score", { ascending: false }).order("published_at", { ascending: false }); break;
    default: query = query.order("published_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  }
  const from = (page - 1) * pageSize;
  const { data, count, error } = await query.range(from, from + pageSize - 1);
  if (error) throw new Error(`Catalogue query failed: ${error.message}`);
  const rows = (data ?? []) as unknown as RawProduct[];
  const stock = await stockFor(rows.map((r) => r.id));
  return { items: shape(rows, stock), total: count ?? 0, page, pageSize };
}

export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(`${PRODUCT_FIELDS}, sku, description, size_guide, specifications, deposit_percentage, preorder_lead_days_min, preorder_lead_days_max, seo_title, seo_description, categories(name, slug)`)
    .eq("slug", slug).eq("status", "active").is("deleted_at", null).maybeSingle();
  if (!data) return null;
  const raw = data as unknown as RawProduct & { categories: { name: string; slug: string } | null } & Omit<ProductDetail, keyof ProductCard | "category">;
  const stock = await stockFor([raw.id]);
  const [card] = shape([raw], stock);
  return { ...(raw as unknown as ProductDetail), ...card, category: raw.categories ?? null };
}

export async function getFacets(): Promise<{ sizes: string[]; colors: { name: string; hex: string | null }[] }> {
  if (!isSupabaseConfigured()) return { sizes: [], colors: [] };
  const supabase = await createClient();
  const { data } = await supabase.from("product_variants").select("size, color, color_hex").is("deleted_at", null).eq("is_active", true).limit(2000);
  const sizes = [...new Set((data ?? []).map((r: { size: string | null }) => r.size).filter(Boolean) as string[])];
  const colorMap = new Map<string, string | null>();
  (data ?? []).forEach((r: { color: string | null; color_hex: string | null }) => r.color && colorMap.set(r.color, r.color_hex));
  return { sizes, colors: [...colorMap].map(([name, hex]) => ({ name, hex })) };
}

export const getSiteContent = cache(async () => {
  if (!isSupabaseConfigured()) return [] as SiteBlock[];
  const supabase = await createClient();
  const { data } = await supabase.from("site_content").select("*").order("sort_order");
  return (data ?? []) as SiteBlock[];
});

export interface SiteBlock {
  id: string; block_type: "announcement" | "hero" | "promo_banner" | "section" | "page"; key: string | null; title: string | null;
  subtitle: string | null; body: string | null; image_url: string | null; link_url: string | null; cta_label: string | null;
  data: Record<string, unknown>; sort_order: number;
}

export async function getPublishedReviews(limit = 6) {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("reviews").select("id, author_name, rating, body, created_at").eq("is_published", true).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as { id: string; author_name: string; rating: number; body: string; created_at: string }[];
}

export async function getActiveZones() {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("delivery_zones").select("id, name, fee, promo_fee, promo_ends_at, free_threshold, estimated_days, parent_id").eq("is_active", true).order("sort_order");
  return (data ?? []) as { id: string; name: string; fee: string; promo_fee: string | null; promo_ends_at: string | null; free_threshold: string | null; estimated_days: string | null; parent_id: string | null }[];
}
