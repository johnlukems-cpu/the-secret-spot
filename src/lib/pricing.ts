/**
 * Pricing engine – landed cost and selling price calculation.
 *
 * All arithmetic uses decimal.js (no binary floating point). Results are
 * returned as strings with fixed precision so they can be stored in Postgres
 * NUMERIC columns without loss.
 *
 * Definitions
 *  - Landed cost   = everything it costs to get one unit on the shelf in Suriname (SRD).
 *  - Gross margin  = (price − cost) / price         ← used for "target margin"
 *  - Markup        = (price − cost) / cost
 *  - Recommended selling price = landed cost / (1 − target margin)
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Currency = "SRD" | "EUR" | "USD" | "CNY";
export type AllocationMode = "units" | "value" | "weight" | "volume" | "manual";

type Num = number | string;

export interface PricingInput {
  supplierPrice: Num;            // per unit, supplier currency
  supplierCurrency: Currency;
  exchangeRateToSRD: Num;        // 1 supplier currency = x SRD (must be supplied, never assumed)
  quantity?: Num;                // units the shared costs below are spread over (default 1)
  // Costs in SRD for the whole quantity (shared) – allocated per unit
  shippingSRD?: Num;
  customsDutyPct?: Num;          // % of customs value (purchase price + shipping)
  importTaxPct?: Num;            // % of (customs value + duty)
  customsDutySRD?: Num;          // fixed amounts (alternative to percentages)
  importTaxSRD?: Num;
  clearanceSRD?: Num;
  localTransportSRD?: Num;
  packagingSRD?: Num;            // per unit
  otherSRD?: Num;
  targetMarginPct: Num;          // 0 ≤ margin < 100
  promoDiscountPct?: Num;        // optional promotional discount on the selling price
  roundingStep?: Num;            // round recommended price UP to this step (e.g. 5 SRD); 0 = none
  overridePriceSRD?: Num | null; // manual price chosen by the administrator
}

export interface PricingResult {
  convertedPriceSRD: string;
  shippingPerUnit: string;
  customsPerUnit: string;
  importTaxPerUnit: string;
  clearancePerUnit: string;
  otherDirectPerUnit: string;    // local transport + packaging + other
  landedCostPerUnit: string;
  targetMarginPct: string;
  recommendedPrice: string;      // before rounding
  recommendedPriceRounded: string;
  finalPrice: string;            // override or rounded recommendation
  promoPrice: string | null;     // final price after promotional discount
  expectedProfit: string;        // per unit at finalPrice
  actualMarginPct: string;       // at finalPrice
  markupPct: string;             // at finalPrice
  promoProfit: string | null;
  promoMarginPct: string | null;
  warnings: string[];
}

const d = (v: Num | null | undefined) => new Decimal(v === undefined || v === null || v === "" ? 0 : v);

export function calculatePrice(input: PricingInput): PricingResult {
  const warnings: string[] = [];
  const qty = d(input.quantity ?? 1);
  if (qty.lte(0)) throw new Error("Quantity must be greater than 0");
  const rate = d(input.exchangeRateToSRD);
  if (input.supplierCurrency !== "SRD" && rate.lte(0)) {
    throw new Error("An exchange rate is required for non-SRD supplier prices");
  }
  const margin = d(input.targetMarginPct);
  if (margin.lt(0) || margin.gte(100)) throw new Error("Target margin must be between 0 and 100 (exclusive)");

  const converted = d(input.supplierPrice).mul(input.supplierCurrency === "SRD" ? 1 : rate);
  const shippingPU = d(input.shippingSRD).div(qty);
  const customsValue = converted.add(shippingPU);
  const dutyPU = input.customsDutySRD !== undefined && input.customsDutySRD !== ""
    ? d(input.customsDutySRD).div(qty)
    : customsValue.mul(d(input.customsDutyPct)).div(100);
  const taxPU = input.importTaxSRD !== undefined && input.importTaxSRD !== ""
    ? d(input.importTaxSRD).div(qty)
    : customsValue.add(dutyPU).mul(d(input.importTaxPct)).div(100);
  const clearancePU = d(input.clearanceSRD).div(qty);
  const otherPU = d(input.localTransportSRD).div(qty).add(d(input.packagingSRD)).add(d(input.otherSRD).div(qty));
  const landed = converted.add(shippingPU).add(dutyPU).add(taxPU).add(clearancePU).add(otherPU);

  const recommended = landed.div(new Decimal(1).sub(margin.div(100)));
  const step = d(input.roundingStep);
  const rounded = step.gt(0) ? recommended.div(step).ceil().mul(step) : recommended.toDecimalPlaces(2);
  const hasOverride = input.overridePriceSRD !== undefined && input.overridePriceSRD !== null && input.overridePriceSRD !== "";
  const final = hasOverride ? d(input.overridePriceSRD!) : rounded;

  const profit = final.sub(landed);
  const marginAt = (price: Decimal) => (price.gt(0) ? price.sub(landed).div(price).mul(100) : new Decimal(0));
  const markup = landed.gt(0) ? profit.div(landed).mul(100) : new Decimal(0);
  if (hasOverride && final.lt(rounded)) warnings.push("De handmatige prijs ligt onder de aanbevolen prijs.");
  if (profit.lt(0)) warnings.push("Verkoopprijs ligt onder de landed cost: verlies per stuk.");

  const promoPct = d(input.promoDiscountPct);
  let promoPrice: Decimal | null = null;
  if (promoPct.gt(0)) {
    promoPrice = final.mul(new Decimal(100).sub(promoPct)).div(100).toDecimalPlaces(2);
    if (promoPrice.lt(landed)) warnings.push("De promotieprijs ligt onder de landed cost.");
  }

  const f2 = (x: Decimal) => x.toFixed(2);
  const f4 = (x: Decimal) => x.toFixed(4);
  return {
    convertedPriceSRD: f4(converted),
    shippingPerUnit: f4(shippingPU),
    customsPerUnit: f4(dutyPU),
    importTaxPerUnit: f4(taxPU),
    clearancePerUnit: f4(clearancePU),
    otherDirectPerUnit: f4(otherPU),
    landedCostPerUnit: f4(landed),
    targetMarginPct: f2(margin),
    recommendedPrice: f2(recommended),
    recommendedPriceRounded: f2(rounded),
    finalPrice: f2(final),
    promoPrice: promoPrice ? f2(promoPrice) : null,
    expectedProfit: f2(profit),
    actualMarginPct: f2(marginAt(final)),
    markupPct: f2(markup),
    promoProfit: promoPrice ? f2(promoPrice.sub(landed)) : null,
    promoMarginPct: promoPrice ? f2(marginAt(promoPrice)) : null,
    warnings,
  };
}

/** Converts between margin and markup (both in %). */
export const marginToMarkup = (marginPct: Num) => {
  const m = d(marginPct).div(100);
  if (m.gte(1)) throw new Error("Margin must be below 100%");
  return m.div(new Decimal(1).sub(m)).mul(100).toFixed(2);
};
export const markupToMargin = (markupPct: Num) => {
  const k = d(markupPct).div(100);
  return k.div(new Decimal(1).add(k)).mul(100).toFixed(2);
};

export interface AllocationLine {
  id: string;
  quantity: Num;
  value?: Num;   // goods value SRD
  weight?: Num;
  volume?: Num;
  manualShare?: Num; // fraction 0..1
}

/**
 * Allocates a shared cost over lines (mirrors public.allocate_shipment_costs).
 * Shares are rounded to cents; the rounding remainder goes to the line with the
 * largest basis so the allocation always sums exactly to the total.
 */
export function allocateCost(total: Num, lines: AllocationLine[], mode: AllocationMode): Record<string, string> {
  const basisOf = (l: AllocationLine) =>
    d(mode === "value" ? l.value : mode === "weight" ? l.weight : mode === "volume" ? l.volume : mode === "units" ? l.quantity : l.manualShare);
  const sum = lines.reduce((s, l) => s.add(basisOf(l)), new Decimal(0));
  if (sum.lte(0)) throw new Error(`Every line needs a ${mode} value to allocate costs`);
  if (mode === "manual" && sum.sub(1).abs().gt(0.0001)) throw new Error("Manual shares must sum to 1");
  const t = d(total);
  const sorted = [...lines].sort((a, b) => basisOf(a).cmp(basisOf(b)) || a.id.localeCompare(b.id));
  const out: Record<string, Decimal> = {};
  let allocated = new Decimal(0);
  for (const l of sorted) {
    const share = t.mul(basisOf(l)).div(sum).toDecimalPlaces(2);
    out[l.id] = share;
    allocated = allocated.add(share);
  }
  const last = sorted[sorted.length - 1];
  out[last.id] = out[last.id].add(t.sub(allocated));
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.toFixed(2)]));
}
