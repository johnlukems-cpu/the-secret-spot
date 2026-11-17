"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import { can, getSession } from "@/lib/auth";
import { calculatePrice, type PricingInput } from "@/lib/pricing";
import type { ActionResult } from "../action-types";

const cur = z.enum(["SRD", "EUR", "USD", "CNY"]);

export async function addExchangeRateAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ from: cur, to: cur, rate: z.coerce.number().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.string().max(80).optional(), notes: z.string().max(300).optional() }), fd);
  if (!f.ok) return f;
  if (f.data.from === f.data.to) return { ok: false, error: "Kies twee verschillende valuta." };
  return adminAction("pricing.manage", async ({ supabase, userId }) => {
    check(await supabase.from("exchange_rates").upsert({ from_currency: f.data.from, to_currency: f.data.to, rate: f.data.rate, effective_date: f.data.date, source: f.data.source || null, notes: f.data.notes || null, created_by: userId }, { onConflict: "from_currency,to_currency,effective_date" }));
    return { ok: true, message: "Wisselkoers opgeslagen" };
  }, ["/admin/pricing"]);
}

/** Recalculates on the server (never trusts browser figures) and stores the estimate. */
export async function saveCalculationAction(input: PricingInput & { productId?: string; variantId?: string; exchangeRateId?: string; applyPrice?: boolean; notes?: string; mode?: string }): Promise<ActionResult<unknown>> {
  let r;
  try { r = calculatePrice(input); } catch (e) { return { ok: false, error: String((e as Error).message) }; }
  const session = await getSession();
  if (input.applyPrice && !can(session, "products.manage")) return { ok: false, error: "U mag geen productprijzen wijzigen." };
  return adminAction("pricing.manage", async ({ supabase, userId }) => {
    const q = Number(input.quantity ?? 1);
    check(await supabase.from("cost_calculations").insert({
      product_id: input.productId || null, variant_id: input.variantId || null, is_estimate: true,
      allocation_mode: ["units", "value", "weight", "volume", "manual"].includes(input.mode ?? "") ? input.mode : "units", quantity: q,
      supplier_price: input.supplierPrice, supplier_currency: input.supplierCurrency,
      exchange_rate: input.supplierCurrency === "SRD" ? 1 : input.exchangeRateToSRD, exchange_rate_id: input.exchangeRateId || null,
      converted_price_srd: r.convertedPriceSRD, shipping_srd: r.shippingPerUnit, customs_srd: r.customsPerUnit, import_tax_srd: r.importTaxPerUnit,
      clearance_srd: r.clearancePerUnit, other_srd: r.otherDirectPerUnit, landed_cost_srd: r.landedCostPerUnit,
      target_margin_pct: r.targetMarginPct, recommended_price_srd: r.recommendedPriceRounded,
      override_price_srd: input.overridePriceSRD ? Number(input.overridePriceSRD) : null, final_price_srd: r.finalPrice,
      promo_discount_pct: Number(input.promoDiscountPct ?? 0), expected_profit_srd: r.expectedProfit, actual_margin_pct: r.actualMarginPct,
      markup_pct: r.markupPct, inputs: input as unknown as Record<string, unknown>, notes: input.notes ?? null, created_by: userId,
    }));
    if (input.applyPrice && input.productId) {
      check(await supabase.from("products").update({ base_price: r.finalPrice, promo_price: r.promoPrice }).eq("id", input.productId));
    }
    return { ok: true, message: input.applyPrice ? "Berekening opgeslagen en prijs toegepast" : "Berekening opgeslagen" };
  }, ["/admin/pricing"]);
}
