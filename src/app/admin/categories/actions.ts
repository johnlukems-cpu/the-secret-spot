"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import { slugify } from "@/lib/utils";
import type { ActionResult } from "../action-types";

export async function saveCategoryAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    id: z.string().uuid().optional().or(z.literal("")), name: z.string().trim().min(2).max(80), name_en: z.string().max(80).optional(),
    slug: z.string().max(80).optional(), parent_id: z.string().uuid().optional().or(z.literal("")),
    sort_order: z.coerce.number().int().default(0), is_active: z.string().optional(), description: z.string().max(500).optional(),
  }), fd);
  if (!f.ok) return f;
  const v = f.data;
  const row = { name: v.name, name_en: v.name_en || null, slug: slugify(v.slug || v.name), parent_id: v.parent_id || null, sort_order: v.sort_order, is_active: v.id ? !!v.is_active : true, description: v.description || null };
  if (v.id && v.parent_id === v.id) return { ok: false, error: "Een categorie kan niet zijn eigen bovenliggende categorie zijn." };
  return adminAction("categories.manage", async ({ supabase }) => {
    if (v.id) check(await supabase.from("categories").update(row).eq("id", v.id));
    else check(await supabase.from("categories").insert(row));
  }, ["/admin/categories", "/"]);
}

export async function deleteCategoryAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const id = String(fd.get("id"));
  return adminAction("categories.manage", async ({ supabase }) => {
    const { count } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("category_id", id).is("deleted_at", null);
    if (count) return { ok: false, error: `Er zijn nog ${count} producten in deze categorie. Verplaats ze eerst of deactiveer de categorie.` };
    check(await supabase.from("categories").update({ deleted_at: new Date().toISOString(), is_active: false }).eq("id", id));
    return { ok: true, message: "Categorie verwijderd" };
  }, ["/admin/categories"]);
}
