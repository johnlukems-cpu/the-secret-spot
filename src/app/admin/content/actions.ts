"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import type { ActionResult } from "../action-types";

export async function saveBlockAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    id: z.string().uuid().optional().or(z.literal("")), block_type: z.enum(["announcement", "hero", "promo_banner", "section", "page"]),
    key: z.string().max(80).optional(), title: z.string().max(200).optional(), subtitle: z.string().max(500).optional(), body: z.string().max(20000).optional(),
    image_url: z.string().max(500).optional(), link_url: z.string().max(300).optional(), cta_label: z.string().max(60).optional(),
    sort_order: z.coerce.number().int().default(0), is_active: z.string().optional(), starts_at: z.string().optional(), ends_at: z.string().optional(),
  }), fd);
  if (!f.ok) return f;
  const { id, ...v } = f.data;
  const isSafeUrl = (u?: string) => !u || u.startsWith("/") || /^https:\/\//.test(u);
  if (!isSafeUrl(v.link_url) || !isSafeUrl(v.image_url)) return { ok: false, error: "Links moeten met / of https:// beginnen." };
  const row = Object.fromEntries(Object.entries({ ...v, is_active: !!v.is_active }).map(([k, val]) => [k, val === "" ? null : val]));
  return adminAction("content.manage", async ({ supabase }) => {
    if (id) check(await supabase.from("site_content").update(row).eq("id", id));
    else check(await supabase.from("site_content").insert(row));
  }, ["/admin/content", "/"]);
}

export async function deleteBlockAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return adminAction("content.manage", async ({ supabase }) => { check(await supabase.from("site_content").delete().eq("id", String(fd.get("id")))); }, ["/admin/content", "/"]);
}

export async function saveReviewAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ id: z.string().uuid().optional().or(z.literal("")), author_name: z.string().trim().min(1).max(80), rating: z.coerce.number().int().min(1).max(5), body: z.string().trim().min(3).max(1000), is_published: z.string().optional() }), fd);
  if (!f.ok) return f;
  const { id, ...v } = f.data;
  return adminAction("content.manage", async ({ supabase }) => {
    const row = { ...v, is_published: !!v.is_published };
    if (id) check(await supabase.from("reviews").update(row).eq("id", id)); else check(await supabase.from("reviews").insert(row));
  }, ["/admin/content", "/"]);
}
