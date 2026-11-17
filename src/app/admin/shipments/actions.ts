"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import type { ActionResult } from "../action-types";

const cur = z.enum(["SRD", "EUR", "USD", "CNY"]);
const optNum = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).nullable()) as z.ZodType<number | null>;
const paths = (id: string) => [`/admin/shipments/${id}`, "/admin/shipments"];

export async function saveShipmentAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    id: z.string().uuid().optional().or(z.literal("")), supplier_id: z.string().uuid().optional().or(z.literal("")),
    shipping_agent: z.string().max(120).optional(), tracking_number: z.string().max(120).optional(), shipping_method: z.string().max(40).optional(),
    departure_date: z.string().optional(), estimated_arrival: z.string().optional(), total_weight_kg: optNum, total_volume_m3: optNum,
    notes: z.string().max(2000).optional(),
  }), fd);
  if (!f.ok) return f;
  const { id, ...v } = f.data;
  const row = { ...v, supplier_id: v.supplier_id || null, departure_date: v.departure_date || null, estimated_arrival: v.estimated_arrival || null,
    shipping_agent: v.shipping_agent || null, tracking_number: v.tracking_number || null, shipping_method: v.shipping_method || null, notes: v.notes || null };
  let newId: string | null = null;
  const res = await adminAction("shipments.manage", async ({ supabase, userId }) => {
    if (id) { check(await supabase.from("shipments").update(row).eq("id", id)); return; }
    const num = `SHP-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
    const { data } = check(await supabase.from("shipments").insert({ ...row, shipment_number: num, created_by: userId }).select("id").single());
    newId = (data as { id: string }).id;
  }, id ? paths(id) : ["/admin/shipments"]);
  if (res.ok && newId) redirect(`/admin/shipments/${newId}`);
  return res;
}

export async function addShipmentLineAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ shipmentId: z.string().uuid(), poItemId: z.string().uuid("Kies een PO-regel"), quantity: z.coerce.number().int().positive(), weight: optNum, volume: optNum }), fd);
  if (!f.ok) return f;
  const v = f.data;
  return adminAction("shipments.manage", async ({ supabase }) => {
    const { data: poi } = check(await supabase.from("purchase_order_items").select("variant_id").eq("id", v.poItemId).single());
    check(await supabase.from("shipment_items").insert({ shipment_id: v.shipmentId, purchase_order_item_id: v.poItemId, variant_id: (poi as { variant_id: string }).variant_id, quantity_shipped: v.quantity, weight_kg: v.weight, volume_m3: v.volume }));
  }, paths(v.shipmentId));
}

export async function updateShipmentLineAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ shipmentId: z.string().uuid(), id: z.string().uuid(), weight: optNum, volume: optNum, manual: optNum }), fd);
  if (!f.ok) return f;
  const v = f.data;
  return adminAction("shipments.manage", async ({ supabase }) => {
    check(await supabase.from("shipment_items").update({ weight_kg: v.weight, volume_m3: v.volume, manual_share: v.manual }).eq("id", v.id));
  }, paths(v.shipmentId));
}

export async function removeShipmentLineAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const shipmentId = String(fd.get("shipmentId")); const id = String(fd.get("id"));
  return adminAction("shipments.manage", async ({ supabase }) => {
    const { data } = await supabase.from("shipment_items").select("quantity_received, quantity_damaged").eq("id", id).single();
    if (data && data.quantity_received + data.quantity_damaged > 0) return { ok: false, error: "Regel is al (deels) ontvangen en kan niet worden verwijderd." };
    check(await supabase.from("shipment_items").delete().eq("id", id));
  }, paths(shipmentId));
}

export async function setShipmentStatusAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const shipmentId = String(fd.get("shipmentId"));
  const status = String(fd.get("status"));
  return adminAction("shipments.manage", async ({ supabase }) => {
    check(await supabase.rpc("set_shipment_status", { _shipment_id: shipmentId, _status: status }));
  }, paths(shipmentId));
}

export async function addImportCostAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    shipmentId: z.string().uuid(), cost_type: z.enum(["shipping", "customs_duty", "import_tax", "clearance", "local_transport", "packaging", "other"]),
    description: z.string().max(200).optional(), amount: z.coerce.number().min(0), currency: cur,
    exchange_rate: z.coerce.number().positive("Wisselkoers naar SRD is verplicht (1 voor SRD)"), is_estimate: z.string().optional(),
    invoice_ref: z.string().max(80).optional(), paid_at: z.string().optional(),
  }), fd);
  if (!f.ok) return f;
  const { shipmentId, ...v } = f.data;
  if (v.currency === "SRD" && v.exchange_rate !== 1) return { ok: false, error: "Voor SRD is de koers 1." };
  return adminAction("shipments.manage", async ({ supabase, userId }) => {
    check(await supabase.from("import_costs").insert({ ...v, shipment_id: shipmentId, is_estimate: !!v.is_estimate, description: v.description || null, invoice_ref: v.invoice_ref || null, paid_at: v.paid_at || null, created_by: userId }));
  }, paths(shipmentId));
}

export async function deleteImportCostAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const shipmentId = String(fd.get("shipmentId"));
  return adminAction("shipments.manage", async ({ supabase }) => { check(await supabase.from("import_costs").delete().eq("id", String(fd.get("id")))); }, paths(shipmentId));
}

export async function allocateCostsAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const shipmentId = String(fd.get("shipmentId")); const method = String(fd.get("method"));
  return adminAction("shipments.manage", async ({ supabase }) => {
    const { data } = check(await supabase.rpc("allocate_shipment_costs", { _shipment_id: shipmentId, _method: method }));
    const r = data as { total_cost_srd: number; uses_actual_costs: boolean };
    return { ok: true, message: `SRD ${r.total_cost_srd} toegerekend (${r.uses_actual_costs ? "werkelijke kosten" : "geschatte kosten"})` };
  }, paths(shipmentId));
}

export async function receiveShipmentAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const shipmentId = String(fd.get("shipmentId"));
  const locationId = String(fd.get("locationId") ?? "") || null;
  const lines: { shipment_item_id: string; received: number; damaged: number }[] = [];
  for (const [k, val] of fd.entries()) {
    const m = /^recv_(.+)$/.exec(k);
    if (m) lines.push({ shipment_item_id: m[1], received: Number(val || 0), damaged: Number(fd.get(`dmg_${m[1]}`) || 0) });
  }
  if (lines.some((l) => !Number.isInteger(l.received) || !Number.isInteger(l.damaged) || l.received < 0 || l.damaged < 0)) return { ok: false, error: "Ongeldige aantallen" };
  if (!lines.some((l) => l.received + l.damaged > 0)) return { ok: false, error: "Vul ontvangen aantallen in." };
  return adminAction("shipments.manage", async ({ supabase }) => {
    const { data } = check(await supabase.rpc("receive_shipment", { _shipment_id: shipmentId, _lines: lines, _location_id: locationId }));
    const r = data as { allocated_units: number; orders_updated: number };
    return { ok: true, message: `Ontvangst verwerkt: ${r.allocated_units} stuks toegewezen aan ${r.orders_updated} klantbestellingen` };
  }, [...paths(shipmentId), "/admin/inventory", "/admin/deliveries"]);
}
