import { describe, expect, it } from "vitest";
import { allocateCost, calculatePrice, marginToMarkup, markupToMargin } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";

describe("calculatePrice", () => {
  it("computes landed cost and margin-based price", () => {
    const r = calculatePrice({
      supplierPrice: 100, supplierCurrency: "CNY", exchangeRateToSRD: 5, quantity: 10,
      shippingSRD: 500, customsDutyPct: 10, importTaxPct: 10, clearanceSRD: 100,
      localTransportSRD: 50, packagingSRD: 5, targetMarginPct: 40, roundingStep: 5,
    });
    // converted 500; shipping 50; duty 10% of 550 = 55; tax 10% of 605 = 60.5; clearance 10; other 5+5 = 10
    expect(r.convertedPriceSRD).toBe("500.0000");
    expect(r.customsPerUnit).toBe("55.0000");
    expect(r.importTaxPerUnit).toBe("60.5000");
    expect(r.landedCostPerUnit).toBe("685.5000");
    expect(r.recommendedPrice).toBe("1142.50"); // 685.5 / 0.6
    expect(r.recommendedPriceRounded).toBe("1145.00");
    expect(r.finalPrice).toBe("1145.00");
    expect(r.expectedProfit).toBe("459.50");
    expect(r.actualMarginPct).toBe("40.13");
    expect(r.markupPct).toBe("67.03");
  });

  it("supports a manual override and warns on loss", () => {
    const r = calculatePrice({ supplierPrice: 200, supplierCurrency: "SRD", exchangeRateToSRD: 1, targetMarginPct: 30, overridePriceSRD: 150 });
    expect(r.finalPrice).toBe("150.00");
    expect(r.expectedProfit).toBe("-50.00");
    expect(r.warnings.length).toBe(2);
  });

  it("applies a promotional discount", () => {
    const r = calculatePrice({ supplierPrice: 10, supplierCurrency: "EUR", exchangeRateToSRD: 40, targetMarginPct: 50, promoDiscountPct: 20 });
    expect(r.finalPrice).toBe("800.00");
    expect(r.promoPrice).toBe("640.00");
    expect(r.promoMarginPct).toBe("37.50");
  });

  it("never assumes an exchange rate", () => {
    expect(() => calculatePrice({ supplierPrice: 1, supplierCurrency: "USD", exchangeRateToSRD: 0, targetMarginPct: 10 })).toThrow(/exchange rate/);
  });

  it("rejects margins of 100% or more", () => {
    expect(() => calculatePrice({ supplierPrice: 1, supplierCurrency: "SRD", exchangeRateToSRD: 1, targetMarginPct: 100 })).toThrow();
  });

  it("avoids floating point errors", () => {
    const r = calculatePrice({ supplierPrice: "0.1", supplierCurrency: "SRD", exchangeRateToSRD: 1, packagingSRD: "0.2", targetMarginPct: 0 });
    expect(r.landedCostPerUnit).toBe("0.3000");
  });
});

describe("margin vs markup", () => {
  it("converts both ways", () => {
    expect(marginToMarkup(40)).toBe("66.67");
    expect(markupToMargin(100)).toBe("50.00");
  });
});

describe("allocateCost", () => {
  const lines = [
    { id: "a", quantity: 3, value: 1500, weight: 3 },
    { id: "b", quantity: 3, value: 900, weight: 1.5 },
    { id: "c", quantity: 2, value: 400, weight: 0.5 },
  ];
  it("allocates by value (same result as the database function)", () => {
    expect(allocateCost(840, lines, "value")).toEqual({ a: "450.00", b: "270.00", c: "120.00" });
  });
  it("allocates by weight and units, always summing to the total", () => {
    expect(allocateCost(840, lines, "weight")).toEqual({ a: "504.00", b: "252.00", c: "84.00" });
    const u = allocateCost(100, lines, "units");
    expect(Object.values(u).reduce((s, v) => s + Number(v), 0)).toBeCloseTo(100, 10);
    expect(u).toEqual({ a: "37.50", b: "37.50", c: "25.00" });
  });
  it("puts rounding remainders on the largest line", () => {
    const r = allocateCost(100, [{ id: "x", quantity: 1 }, { id: "y", quantity: 1 }, { id: "z", quantity: 1 }], "units");
    expect(r).toEqual({ x: "33.33", y: "33.33", z: "33.34" });
  });
  it("validates manual shares", () => {
    expect(() => allocateCost(10, [{ id: "x", quantity: 1, manualShare: 0.5 }], "manual")).toThrow(/sum to 1/);
  });
});

describe("formatMoney", () => {
  it("formats SRD with Dutch separators", () => {
    expect(formatMoney(1450)).toBe("SRD 1.450,00");
    expect(formatMoney("12.5", "EUR")).toBe("EUR 12,50");
  });
});
