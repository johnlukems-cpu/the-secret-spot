"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import type { ActionResult } from "../action-types";

const cur = z.enum(["SRD", "EUR", "USD", "CNY"]);

export async function saveSupplierAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    id: z.string().uuid().optional().or(z.literal("")), code: z.string().max(30).optional(), name: z.string().trim().min(2).max(120),
    contact_person: z.string().max(120).optional(), email: z.union([z.literal(""), z.string().email()]).optional(), phone: z.string().max(40).optional(),
    website: z.string().max(200).optional(), platform: z.string().max(60).optional(), country: z.string().max(60).default("China"),
    currency: cur, payment_terms: z.string().max(200).optional(), shipping_method: z.string().max(100).optional(),
    rating: z.preprocess((v) => (v === "" ? null : Number(v)), z.number().int().min(1).max(5).nullable()), notes: z.string().max(2000).optional(),
  }), fd);
  if (!f.ok) return f;
  const { id, ...v } = f.data;
  const row = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val === "" ? null : val]));
  return adminAction("suppliers.manage", async ({ supabase }) => {
    if (id) check(await supabase.from("suppliers").update(row).eq("id", id));
    else check(await supabase.from("suppliers").insert(row));
  }, ["/admin/suppliers"]);
}

export async function saveSupplierProductAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    supplier_id: z.string().uuid(), variant_id: z.string().uuid().optional().or(z.literal("")), product_id: z.string().uuid().optional().or(z.literal("")),
    unit_cost: z.coerce.number().min(0), currency: cur, supplier_sku: z.string().max(80).optional(), supplier_url: z.string().max(500).optional(),
    min_order_qty: z.coerce.number().int().min(1).default(1), lead_time_days: z.preprocess((v) => (v === "" ? null : Number(v)), z.number().int().min(0).nullable()),
  }), fd);
  if (!f.ok) return f;
  const v = f.data;
  if (!v.variant_id && !v.product_id) return { ok: false, error: "Kies een product of variant." };
  return adminAction("suppliers.manage", async ({ supabase }) => {
    let productId = v.product_id || null;
    if (v.variant_id) productId = (await supabase.from("product_variants").select("product_id").eq("id", v.variant_id).single()).data?.product_id ?? productId;
    check(await supabase.from("supplier_products").insert({ ...v, variant_id: v.variant_id || null, product_id: productId, supplier_sku: v.supplier_sku || null, supplier_url: v.supplier_url || null }));
  }, ["/admin/suppliers"]);
}

export async function deleteSupplierProductAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return adminAction("suppliers.manage", async ({ supabase }) => { check(await supabase.from("supplier_products").delete().eq("id", String(fd.get("id")))); }, ["/admin/suppliers"]);
}
