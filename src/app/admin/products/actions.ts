"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import { slugify } from "@/lib/utils";
import { sniffMime } from "@/lib/validation";
import type { ActionResult } from "../action-types";

const num = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).nullable()) as z.ZodType<number | null>;
const int = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(0).nullable()) as z.ZodType<number | null>;

const productSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  title: z.string().trim().min(2).max(200),
  sku: z.string().trim().min(2).max(60),
  slug: z.string().trim().max(120).optional(),
  description: z.string().max(5000).optional(),
  category_id: z.string().uuid().optional().or(z.literal("")),
  brand: z.string().max(80).optional(),
  sales_type: z.enum(["ready", "preorder", "coming_soon"]),
  status: z.enum(["draft", "active", "archived"]),
  base_price: z.coerce.number().min(0),
  promo_price: num, promo_starts_at: z.string().optional(), promo_ends_at: z.string().optional(),
  deposit_percentage: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).max(100).nullable()),
  estimated_delivery_text: z.string().max(120).optional(),
  preorder_lead_days_min: int, preorder_lead_days_max: int,
  size_guide: z.string().max(3000).optional(),
  specifications: z.string().max(3000).optional(),
  tags: z.string().max(500).optional(),
  weight_kg: num, volume_m3: num,
  default_supplier_id: z.string().uuid().optional().or(z.literal("")),
  seo_title: z.string().max(120).optional(), seo_description: z.string().max(300).optional(),
  is_featured: z.string().optional(), is_new_arrival: z.string().optional(), is_best_seller: z.string().optional(),
});

export async function saveProductAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(productSchema, fd);
  if (!f.ok) return f;
  const v = f.data;
  if (v.promo_price != null && Number(v.promo_price) >= v.base_price) return { ok: false, error: "Promotieprijs moet lager zijn dan de normale prijs." };
  const specs = Object.fromEntries((v.specifications ?? "").split("\n").map((l) => l.split(":")).filter((p) => p.length >= 2 && p[0].trim()).map(([k, ...rest]) => [k.trim(), rest.join(":").trim()]));
  const row = {
    title: v.title, sku: v.sku.toUpperCase(), slug: slugify(v.slug || `${v.title}-${v.sku}`), description: v.description || null,
    category_id: v.category_id || null, brand: v.brand || null, sales_type: v.sales_type, status: v.status,
    base_price: v.base_price, promo_price: v.promo_price, promo_starts_at: v.promo_starts_at || null, promo_ends_at: v.promo_ends_at || null,
    deposit_percentage: v.deposit_percentage, estimated_delivery_text: v.estimated_delivery_text || null,
    preorder_lead_days_min: v.preorder_lead_days_min, preorder_lead_days_max: v.preorder_lead_days_max,
    size_guide: v.size_guide || null, specifications: specs, tags: (v.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    weight_kg: v.weight_kg, volume_m3: v.volume_m3, default_supplier_id: v.default_supplier_id || null,
    seo_title: v.seo_title || null, seo_description: v.seo_description || null,
    is_featured: !!v.is_featured, is_new_arrival: !!v.is_new_arrival, is_best_seller: !!v.is_best_seller,
  };
  let newId: string | null = null;
  const res = await adminAction("products.manage", async ({ supabase }) => {
    if (v.id) {
      const { data: existing } = await supabase.from("products").select("published_at").eq("id", v.id).single();
      check(await supabase.from("products").update({ ...row, published_at: existing?.published_at ?? (v.status === "active" ? new Date().toISOString() : null) }).eq("id", v.id));
    } else {
      const { data } = check(await supabase.from("products").insert({ ...row, published_at: v.status === "active" ? new Date().toISOString() : null }).select("id").single());
      newId = (data as { id: string }).id;
    }
  }, ["/admin/products", "/", "/collectie"]);
  if (res.ok && newId) redirect(`/admin/products/${newId}`);
  return res;
}

export async function archiveProductAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const id = String(fd.get("id"));
  return adminAction("products.manage", async ({ supabase }) => {
    check(await supabase.from("products").update({ status: "archived" }).eq("id", id));
    return { ok: true, message: "Product gearchiveerd" };
  }, ["/admin/products", `/admin/products/${id}`]);
}

const variantSchema = z.object({
  product_id: z.string().uuid(), id: z.string().uuid().optional().or(z.literal("")),
  sku: z.string().trim().min(2).max(80), size: z.string().trim().max(30).optional(), color: z.string().trim().max(40).optional(),
  color_hex: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  price_override: num, sort_order: z.coerce.number().int().default(0), is_active: z.string().optional(),
});

export async function saveVariantAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(variantSchema, fd);
  if (!f.ok) return f;
  const v = f.data;
  const row = {
    product_id: v.product_id, sku: v.sku.toUpperCase(), size: v.size || null, color: v.color || null,
    color_hex: v.color_hex ? (v.color_hex.startsWith("#") ? v.color_hex : `#${v.color_hex}`) : null,
    price_override: v.price_override, sort_order: v.sort_order, is_active: v.id ? !!v.is_active : true,
  };
  return adminAction("products.manage", async ({ supabase }) => {
    if (v.id) check(await supabase.from("product_variants").update(row).eq("id", v.id));
    else check(await supabase.from("product_variants").insert(row));
  }, [`/admin/products/${v.product_id}`]);
}

export async function deleteVariantAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const id = String(fd.get("id")); const productId = String(fd.get("product_id"));
  return adminAction("products.manage", async ({ supabase }) => {
    check(await supabase.from("product_variants").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", id));
    return { ok: true, message: "Variant verwijderd (historie blijft bewaard)" };
  }, [`/admin/products/${productId}`]);
}

export async function uploadImageAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const productId = String(fd.get("product_id"));
  const file = fd.get("file");
  const alt = String(fd.get("alt") ?? "").slice(0, 200);
  const color = String(fd.get("color") ?? "").slice(0, 40) || null;
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Kies een afbeelding." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Maximaal 5 MB per afbeelding." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime || mime === "application/pdf") return { ok: false, error: "Alleen JPG, PNG of WEBP." };
  return adminAction("products.manage", async ({ supabase }) => {
    const path = `${productId}/${randomUUID()}.${mime.split("/")[1].replace("jpeg", "jpg")}`;
    check(await supabase.storage.from("product-images").upload(path, bytes, { contentType: mime, cacheControl: "31536000" }));
    const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
    const { count } = await supabase.from("product_images").select("id", { count: "exact", head: true }).eq("product_id", productId);
    check(await supabase.from("product_images").insert({ product_id: productId, url: pub.publicUrl, storage_path: path, alt: alt || null, color, sort_order: count ?? 0 }));
    return { ok: true, message: "Afbeelding geüpload" };
  }, [`/admin/products/${productId}`]);
}

export async function deleteImageAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const id = String(fd.get("id")); const productId = String(fd.get("product_id"));
  return adminAction("products.manage", async ({ supabase }) => {
    const { data } = await supabase.from("product_images").select("storage_path").eq("id", id).single();
    check(await supabase.from("product_images").delete().eq("id", id));
    if (data?.storage_path) await supabase.storage.from("product-images").remove([data.storage_path]);
  }, [`/admin/products/${productId}`]);
}

export async function setImageOrderAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const id = String(fd.get("id")); const productId = String(fd.get("product_id")); const order = Number(fd.get("sort_order") ?? 0);
  return adminAction("products.manage", async ({ supabase }) => {
    check(await supabase.from("product_images").update({ sort_order: order }).eq("id", id));
  }, [`/admin/products/${productId}`]);
}
