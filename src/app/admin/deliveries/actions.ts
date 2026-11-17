"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import type { ActionResult } from "../action-types";

export async function updateDeliveryAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    deliveryId: z.string().uuid(), status: z.enum(["awaiting_preparation", "ready_for_delivery", "assigned", "out_for_delivery", "delivered", "failed", "rescheduled"]),
    note: z.string().max(500).optional(), scheduled: z.string().optional(), assignedTo: z.string().uuid().optional().or(z.literal("")),
    deliveryCost: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().min(0).optional()),
  }), fd);
  if (!f.ok) return f;
  const v = f.data;
  return adminAction("deliveries.manage", async ({ supabase }) => {
    check(await supabase.rpc("update_delivery_status", { _delivery_id: v.deliveryId, _status: v.status, _note: v.note || null, _scheduled: v.scheduled || null, _assigned_to: v.assignedTo || null }));
    if (v.deliveryCost !== undefined) check(await supabase.from("deliveries").update({ delivery_cost_srd: v.deliveryCost }).eq("id", v.deliveryId));
    return { ok: true, message: "Levering bijgewerkt" };
  }, ["/admin/deliveries"]);
}
