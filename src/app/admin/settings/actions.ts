"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import type { ActionResult } from "../action-types";
import { SETTING_DEFS } from "./defs";

export async function saveSettingsAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const updates: { key: string; value: unknown }[] = [];
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    if (!fd.has(`s_${key}`) && def.type !== "boolean") continue;
    const raw = fd.get(`s_${key}`);
    if (def.type === "boolean") { if (fd.has(`present_${key}`)) updates.push({ key, value: raw === "on" }); continue; }
    if (def.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n) || (def.min != null && n < def.min) || (def.max != null && n > def.max)) return { ok: false, error: `${def.label}: ongeldige waarde` };
      updates.push({ key, value: n });
    } else {
      const s = String(raw ?? "").trim().slice(0, def.type === "longtext" ? 5000 : 300);
      if (key.endsWith("_instagram") || key.endsWith("_facebook") || key.endsWith("_tiktok")) {
        if (s && !/^https:\/\//.test(s)) return { ok: false, error: `${def.label} moet met https:// beginnen` };
      }
      updates.push({ key, value: s });
    }
  }
  return adminAction("settings.manage", async ({ supabase, userId }) => {
    for (const u of updates) check(await supabase.from("business_settings").update({ value: u.value, updated_by: userId }).eq("key", u.key));
    return { ok: true, message: `${updates.length} instellingen opgeslagen` };
  }, ["/admin/settings", "/"]);
}

export async function saveZoneAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const opt = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).nullable());
  const f = parseForm(z.object({
    id: z.string().uuid().optional().or(z.literal("")), name: z.string().trim().min(2).max(80), parent_id: z.string().uuid().optional().or(z.literal("")),
    fee: z.coerce.number().min(0), promo_fee: opt, promo_ends_at: z.string().optional(), free_threshold: opt,
    estimated_days: z.string().max(60).optional(), sort_order: z.coerce.number().int().default(0), is_active: z.string().optional(),
  }), fd);
  if (!f.ok) return f;
  const { id, ...v } = f.data;
  const row = { ...v, parent_id: v.parent_id || null, promo_ends_at: v.promo_ends_at || null, estimated_days: v.estimated_days || null, is_active: id ? !!v.is_active : true };
  return adminAction("settings.manage", async ({ supabase }) => {
    if (id) check(await supabase.from("delivery_zones").update(row).eq("id", id)); else check(await supabase.from("delivery_zones").insert(row));
  }, ["/admin/settings"]);
}

export async function savePricingSettingsAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    id: z.string().uuid(), target_margin_pct: z.coerce.number().min(0).max(99.99), customs_duty_pct: z.coerce.number().min(0), import_tax_pct: z.coerce.number().min(0),
    packaging_per_unit_srd: z.coerce.number().min(0), clearance_per_unit_srd: z.coerce.number().min(0), local_transport_per_unit_srd: z.coerce.number().min(0),
    rounding_step: z.coerce.number().min(0), notes: z.string().max(1000).optional(),
  }), fd);
  if (!f.ok) return f;
  const { id, ...v } = f.data;
  return adminAction("pricing.manage", async ({ supabase }) => { check(await supabase.from("pricing_settings").update(v).eq("id", id)); }, ["/admin/settings", "/admin/pricing"]);
}
