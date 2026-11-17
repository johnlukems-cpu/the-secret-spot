import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicEnv.siteUrl;
  const staticPages = ["", "/collectie", "/volg-bestelling", "/contact", "/info/bestellen-en-betalen", "/info/pre-order", "/info/voorwaarden", "/info/privacy"]
    .map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.6 }));
  if (!isSupabaseConfigured()) return staticPages;
  const supabase = createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, { auth: { persistSession: false } });
  const [{ data: products }, { data: cats }] = await Promise.all([
    supabase.from("products").select("slug, updated_at").eq("status", "active").is("deleted_at", null).limit(5000),
    supabase.from("categories").select("slug, updated_at").eq("is_active", true).is("deleted_at", null),
  ]);
  return [
    ...staticPages,
    ...(cats ?? []).map((c) => ({ url: `${base}/collectie/${c.slug}`, lastModified: c.updated_at, changeFrequency: "daily" as const, priority: 0.7 })),
    ...(products ?? []).map((p) => ({ url: `${base}/product/${p.slug}`, lastModified: p.updated_at, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
