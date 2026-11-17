"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import type { ActionResult } from "../action-types";

const idPath = (id: string) => [`/admin/orders/${id}`, "/admin/orders", "/admin/payments", "/admin"];

export async function verifyPaymentAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    paymentId: z.string().uuid(), orderId: z.string().uuid(), decision: z.enum(["approve", "reject", "start"]),
    note: z.string().trim().max(500).optional(), amount: z.string().optional(),
  }), fd);
  if (!f.ok) return f;
  const { paymentId, orderId, decision, note, amount } = f.data;
  return adminAction("payments.verify", async ({ supabase }) => {
    if (decision === "start") {
      check(await supabase.rpc("mark_payment_under_verification", { _payment_id: paymentId }));
      return { ok: true, message: "Gemarkeerd als in verificatie" };
    }
    check(await supabase.rpc("verify_payment", {
      _payment_id: paymentId, _approve: decision === "approve", _note: note || null,
      _verified_amount: amount ? Number(amount) : null,
    }));
    return { ok: true, message: decision === "approve" ? "Betaling geverifieerd" : "Betaling afgewezen" };
  }, idPath(orderId));
}

export async function recordPaymentAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    orderId: z.string().uuid(), amount: z.coerce.number().positive(), method: z.enum(["cash", "bank_transfer", "card_terminal", "mobile_transfer", "other"]),
    reference: z.string().trim().max(120).optional(), deliveryId: z.string().uuid().optional().or(z.literal("")), note: z.string().max(300).optional(),
  }), fd);
  if (!f.ok) return f;
  const v = f.data;
  return adminAction("payments.record", async ({ supabase }) => {
    const { data } = check(await supabase.rpc("record_payment", {
      _order_id: v.orderId, _amount: v.amount, _method: v.method, _reference: v.reference || null,
      _delivery_id: v.deliveryId || null, _note: v.note || null,
    }));
    const r = data as { receipt_number: string; verified: boolean };
    return { ok: true, data: r, message: r.verified ? `Betaling geregistreerd (bon ${r.receipt_number})` : "Overschrijving geregistreerd – wacht op verificatie door finance" };
  }, [...idPath(v.orderId), "/admin/deliveries"]);
}

export async function cancelOrderAdminAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ orderId: z.string().uuid(), reason: z.string().trim().min(3, "Reden verplicht").max(300) }), fd);
  if (!f.ok) return f;
  return adminAction("orders.manage", async ({ supabase }) => {
    check(await supabase.rpc("cancel_order", { _order_id: f.data.orderId, _reason: f.data.reason }));
    return { ok: true, message: "Bestelling geannuleerd en reserveringen vrijgegeven" };
  }, idPath(f.data.orderId));
}

export async function refundAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    orderId: z.string().uuid(), amount: z.coerce.number().positive(), reason: z.string().trim().min(3).max(300),
    method: z.enum(["bank_transfer", "cash", "other"]), reference: z.string().trim().max(120).optional(),
  }), fd);
  if (!f.ok) return f;
  return adminAction("payments.refund", async ({ supabase }) => {
    check(await supabase.rpc("record_refund", { _order_id: f.data.orderId, _amount: f.data.amount, _reason: f.data.reason, _method: f.data.method, _reference: f.data.reference || null }));
    return { ok: true, message: "Terugbetaling geregistreerd" };
  }, idPath(f.data.orderId));
}

export async function saveInternalNoteAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ orderId: z.string().uuid(), note: z.string().max(2000) }), fd);
  if (!f.ok) return f;
  return adminAction("orders.manage", async ({ supabase }) => {
    check(await supabase.from("orders").update({ internal_note: f.data.note }).eq("id", f.data.orderId));
  }, idPath(f.data.orderId));
}

export async function runMaintenanceAction(): Promise<ActionResult<unknown>> {
  return adminAction("orders.manage", async ({ supabase }) => {
    const { data } = check(await supabase.rpc("run_expiry_jobs"));
    const r = data as { released_reservations: number; expired_orders: number; expired_quotations: number };
    return { ok: true, message: `${r.expired_orders} bestellingen verlopen, ${r.released_reservations} reserveringen vrijgegeven, ${r.expired_quotations} offertes verlopen` };
  }, ["/admin/orders"]);
}
