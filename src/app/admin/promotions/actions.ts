"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import type { ActionResult } from "../action-types";

export async function savePromotionAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    id: z.string().uuid().optional().or(z.literal("")), code: z.string().trim().max(40).optional(), name: z.string().trim().min(2).max(120),
    discount_type: z.enum(["percentage", "fixed", "free_delivery"]), discount_value: z.coerce.number().min(0).default(0),
    min_order_amount: z.coerce.number().min(0).default(0), category_id: z.string().uuid().optional().or(z.literal("")),
    starts_at: z.string().optional(), ends_at: z.string().optional(),
    usage_limit: z.preprocess((v) => (v === "" ? null : Number(v)), z.number().int().positive().nullable()), is_active: z.string().optional(),
  }), fd);
  if (!f.ok) return f;
  const { id, ...v } = f.data;
  if (v.discount_type === "percentage" && Number(v.discount_value) > 100) return { ok: false, error: "Percentage max. 100" };
  const row = { ...v, code: v.code ? v.code.toUpperCase() : null, category_id: v.category_id || null, starts_at: v.starts_at || null, ends_at: v.ends_at || null, is_active: !!v.is_active };
  return adminAction("promotions.manage", async ({ supabase }) => {
    if (id) check(await supabase.from("promotions").update(row).eq("id", id));
    else check(await supabase.from("promotions").insert(row));
  }, ["/admin/promotions"]);
}
