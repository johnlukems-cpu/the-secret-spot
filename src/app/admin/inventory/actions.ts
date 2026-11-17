"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import type { ActionResult } from "../action-types";

export async function adjustInventoryAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    variantId: z.string().uuid("Kies een variant"), locationId: z.string().uuid(), kind: z.enum(["add", "remove", "damaged", "returned", "correction"]),
    qty: z.coerce.number().int().min(0), reason: z.string().trim().min(3, "Reden verplicht").max(300),
    unitCost: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().min(0).optional()),
  }), fd);
  if (!f.ok) return f;
  const v = f.data;
  return adminAction("inventory.manage", async ({ supabase }) => {
    check(await supabase.rpc("adjust_inventory", { _variant_id: v.variantId, _location_id: v.locationId, _kind: v.kind, _qty: v.qty, _reason: v.reason, _unit_cost: v.unitCost ?? null }));
    return { ok: true, message: "Voorraad aangepast" };
  }, ["/admin/inventory"]);
}

export async function transferStockAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ variantId: z.string().uuid(), from: z.string().uuid(), to: z.string().uuid(), qty: z.coerce.number().int().positive(), reason: z.string().trim().min(3).max(300) }), fd);
  if (!f.ok) return f;
  return adminAction("inventory.manage", async ({ supabase }) => {
    check(await supabase.rpc("transfer_stock", { _variant_id: f.data.variantId, _from: f.data.from, _to: f.data.to, _qty: f.data.qty, _reason: f.data.reason }));
    return { ok: true, message: "Voorraad verplaatst" };
  }, ["/admin/inventory"]);
}

export async function setThresholdAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const id = String(fd.get("id")); const t = Number(fd.get("threshold"));
  if (!Number.isInteger(t) || t < 0) return { ok: false, error: "Ongeldige drempel" };
  return adminAction("inventory.manage", async ({ supabase }) => { check(await supabase.from("inventory").update({ low_stock_threshold: t }).eq("id", id)); }, ["/admin/inventory"]);
}

export async function addLocationAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ code: z.string().trim().min(2).max(20), name: z.string().trim().min(2).max(80) }), fd);
  if (!f.ok) return f;
  return adminAction("inventory.manage", async ({ supabase }) => { check(await supabase.from("storage_locations").insert({ code: f.data.code.toUpperCase(), name: f.data.name })); }, ["/admin/inventory"]);
}
