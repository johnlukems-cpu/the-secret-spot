"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import type { ActionResult } from "../action-types";

const cur = z.enum(["SRD", "EUR", "USD", "CNY"]);

export async function createPoFromBatchAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const batchId = String(fd.get("batchId"));
  let poId: string | null = null;
  const res = await adminAction("purchasing.manage", async ({ supabase }) => {
    poId = check(await supabase.rpc("create_po_from_batch", { _batch_id: batchId })).data as string;
  }, ["/admin/batches", `/admin/batches/${batchId}`]);
  if (res.ok && poId) redirect(`/admin/batches/po/${poId}`);
  return res;
}

export async function cancelBatchAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const batchId = String(fd.get("batchId"));
  return adminAction("purchasing.manage", async ({ supabase }) => {
    const { count } = await supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("batch_id", batchId).neq("status", "cancelled");
    if (count) return { ok: false, error: "Annuleer eerst de inkooporder van deze batch." };
    check(await supabase.from("purchase_batches").update({ status: "cancelled" }).eq("id", batchId));
    return { ok: true, message: "Batch geannuleerd; de regels komen terug in het inkooprapport" };
  }, ["/admin/batches", `/admin/batches/${batchId}`, "/admin/purchasing"]);
}

export async function createManualPoAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ supplierId: z.string().uuid(), currency: cur, notes: z.string().max(500).optional() }), fd);
  if (!f.ok) return f;
  let poId: string | null = null;
  const res = await adminAction("purchasing.manage", async ({ supabase, userId }) => {
    const { data: num } = check(await supabase.rpc("next_po_number"));
    const { data } = check(await supabase.from("purchase_orders").insert({ po_number: num as string, supplier_id: f.data.supplierId, currency: f.data.currency, notes: f.data.notes || null, created_by: userId }).select("id").single());
    poId = (data as { id: string }).id;
  }, ["/admin/batches"]);
  if (res.ok && poId) redirect(`/admin/batches/po/${poId}`);
  return res;
}

export async function savePoLineAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    poId: z.string().uuid(), id: z.string().uuid().optional().or(z.literal("")), variantId: z.string().uuid().optional().or(z.literal("")),
    quantity: z.coerce.number().int().positive(), unitCost: z.coerce.number().min(0), description: z.string().max(200).optional(),
  }), fd);
  if (!f.ok) return f;
  const v = f.data;
  return adminAction("purchasing.manage", async ({ supabase }) => {
    const { data: po } = await supabase.from("purchase_orders").select("status").eq("id", v.poId).single();
    if (po?.status !== "draft") return { ok: false, error: "Alleen concept-inkooporders kunnen worden aangepast." };
    if (v.id) {
      const { data: line } = await supabase.from("purchase_order_items").select("is_preorder, quantity").eq("id", v.id).single();
      if (line?.is_preorder && v.quantity < line.quantity) return { ok: false, error: "Pre-order regels kunnen niet lager dan de klantbestellingen. Annuleer de klantbestelling eerst." };
      check(await supabase.from("purchase_order_items").update({ quantity: v.quantity, unit_cost: v.unitCost, description: v.description || null }).eq("id", v.id));
    } else {
      if (!v.variantId) return { ok: false, error: "Kies een variant" };
      check(await supabase.from("purchase_order_items").insert({ purchase_order_id: v.poId, variant_id: v.variantId, quantity: v.quantity, unit_cost: v.unitCost, description: v.description || null, is_preorder: false }));
    }
  }, [`/admin/batches/po/${v.poId}`]);
}

export async function setPoStatusAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const poId = String(fd.get("poId"));
  const status = z.enum(["draft", "ordered", "supplier_confirmed", "cancelled"]).safeParse(fd.get("status"));
  if (!status.success) return { ok: false, error: "Ongeldige status" };
  return adminAction("purchasing.manage", async ({ supabase }) => {
    check(await supabase.rpc("set_purchase_order_status", { _po_id: poId, _status: status.data }));
  }, [`/admin/batches/po/${poId}`, "/admin/batches"]);
}

export async function savePoInvoiceAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    poId: z.string().uuid(), supplier_reference: z.string().max(80).optional(), supplier_invoice_ref: z.string().max(80).optional(),
    supplier_invoice_amount: z.preprocess((v) => (v === "" ? null : Number(v)), z.number().min(0).nullable()),
    shipping_estimate: z.coerce.number().min(0).default(0), expected_ship_date: z.string().optional(), notes: z.string().max(1000).optional(),
  }), fd);
  if (!f.ok) return f;
  const { poId, ...v } = f.data;
  return adminAction("purchasing.manage", async ({ supabase }) => {
    check(await supabase.from("purchase_orders").update({ ...v, expected_ship_date: v.expected_ship_date || null }).eq("id", poId));
  }, [`/admin/batches/po/${poId}`]);
}

export async function supplierPaymentAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    poId: z.string().uuid(), supplierId: z.string().uuid(), amount: z.coerce.number().positive(), currency: cur,
    exchangeRate: z.coerce.number().positive("Wisselkoers naar SRD is verplicht"), paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    method: z.string().max(60).optional(), reference: z.string().max(120).optional(),
  }), fd);
  if (!f.ok) return f;
  const v = f.data;
  return adminAction("purchasing.manage", async ({ supabase, userId }) => {
    check(await supabase.from("supplier_payments").insert({ purchase_order_id: v.poId, supplier_id: v.supplierId, amount: v.amount, currency: v.currency, exchange_rate: v.exchangeRate, paid_at: v.paidAt, method: v.method || null, reference: v.reference || null, created_by: userId }));
    return { ok: true, message: "Betaling aan leverancier geregistreerd" };
  }, [`/admin/batches/po/${v.poId}`]);
}
