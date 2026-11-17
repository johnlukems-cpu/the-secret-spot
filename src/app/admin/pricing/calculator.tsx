"use client";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { calculatePrice, marginToMarkup, type Currency, type PricingInput } from "@/lib/pricing";
import { formatSRD } from "@/lib/money";
import { saveCalculationAction } from "./actions";

type Rate = { id: string; from_currency: Currency; to_currency: Currency; rate: string; effective_date: string };
type Product = { id: string; title: string; sku: string; base_price: string; variants: { id: string; sku: string }[] };

export function Calculator({ rates, products, defaults, initialProductId, canApply }: {
  rates: Rate[]; products: Product[]; canApply: boolean; initialProductId?: string;
  defaults: { target_margin_pct: string; customs_duty_pct: string; import_tax_pct: string; packaging_per_unit_srd: string; clearance_per_unit_srd: string; local_transport_per_unit_srd: string; rounding_step: string } | null;
}) {
  const [currency, setCurrency] = useState<Currency>("CNY");
  const latest = useMemo(() => {
    const direct = rates.filter((r) => r.from_currency === currency && r.to_currency === "SRD").sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
    if (direct) return { id: direct.id, rate: direct.rate, date: direct.effective_date, inverse: false };
    const inv = rates.filter((r) => r.from_currency === "SRD" && r.to_currency === currency).sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
    return inv ? { id: inv.id, rate: (1 / Number(inv.rate)).toFixed(8), date: inv.effective_date, inverse: true } : null;
  }, [rates, currency]);
  const [rateOverride, setRateOverride] = useState("");
  const [f, setF] = useState({
    supplierPrice: "", quantity: "1", shippingSRD: "", customsDutyPct: defaults?.customs_duty_pct ?? "0", importTaxPct: defaults?.import_tax_pct ?? "0",
    customsDutySRD: "", importTaxSRD: "", clearanceSRD: "", localTransportSRD: "", packagingSRD: defaults?.packaging_per_unit_srd ?? "0", otherSRD: "",
    targetMarginPct: defaults?.target_margin_pct ?? "40", promoDiscountPct: "", roundingStep: defaults?.rounding_step ?? "5", overridePriceSRD: "",
  });
  const [productId, setProductId] = useState(initialProductId ?? "");
  const [variantId, setVariantId] = useState("");
  const [pending, start] = useTransition();
  const rate = currency === "SRD" ? "1" : rateOverride || latest?.rate || "";
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const input: PricingInput = { ...f, supplierCurrency: currency, exchangeRateToSRD: rate || 0, overridePriceSRD: f.overridePriceSRD || null,
    customsDutySRD: f.customsDutySRD || undefined, importTaxSRD: f.importTaxSRD || undefined };
  let result: ReturnType<typeof calculatePrice> | null = null;
  let error: string | null = null;
  if (f.supplierPrice) {
    try { result = calculatePrice(input); } catch (e) { error = (e as Error).message; }
  }
  const product = products.find((p) => p.id === productId);

  const field = (label: string, k: keyof typeof f, hint?: string) => (
    <label className="text-xs">{label}<input value={f[k]} onChange={set(k)} type="number" step="any" min="0" className="mt-1 block h-9 w-full rounded-md border px-2 text-sm" />{hint && <span className="text-[10px] text-taupe">{hint}</span>}</label>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-5 rounded-lg border bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs">Product (optioneel)
            <select value={productId} onChange={(e) => { setProductId(e.target.value); setVariantId(""); }} className="mt-1 block h-9 w-full rounded-md border px-2 text-sm">
              <option value="">–</option>{products.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.sku})</option>)}
            </select>
          </label>
          {product && product.variants.length > 1 && (
            <label className="text-xs">Variant<select value={variantId} onChange={(e) => setVariantId(e.target.value)} className="mt-1 block h-9 w-full rounded-md border px-2 text-sm"><option value="">Alle varianten</option>{product.variants.map((v) => <option key={v.id} value={v.id}>{v.sku}</option>)}</select></label>
          )}
          {product && <p className="self-end text-xs text-taupe">Huidige prijs: {formatSRD(product.base_price)}</p>}
        </div>
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide">Inkoop</legend>
          {field("Inkoopprijs / stuk", "supplierPrice")}
          <label className="text-xs">Valuta<select value={currency} onChange={(e) => { setCurrency(e.target.value as Currency); setRateOverride(""); }} className="mt-1 block h-9 w-full rounded-md border px-2 text-sm">{["CNY", "USD", "EUR", "SRD"].map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="text-xs">Koers → SRD<input value={rate} onChange={(e) => setRateOverride(e.target.value)} disabled={currency === "SRD"} type="number" step="any" className="mt-1 block h-9 w-full rounded-md border px-2 text-sm" />
            <span className="text-[10px] text-taupe">{currency === "SRD" ? "" : latest ? `Laatst ingesteld: ${latest.date}${latest.inverse ? " (omgekeerd)" : ""}` : "Geen koers ingesteld – vul handmatig in"}</span></label>
          {field("Aantal (voor gedeelde kosten)", "quantity", "Kosten hieronder gelden voor dit aantal")}
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide">Import & kosten (SRD, totaal voor aantal)</legend>
          {field("Internationale verzending", "shippingSRD")}
          {field("Invoerrechten %", "customsDutyPct", "van inkoop + vracht")}
          {field("of invoerrechten bedrag", "customsDutySRD")}
          {field("Importbelasting %", "importTaxPct", "van douanewaarde + rechten")}
          {field("of importbelasting bedrag", "importTaxSRD")}
          {field("Inklaring", "clearanceSRD")}
          {field("Lokaal transport", "localTransportSRD")}
          {field("Verpakking / stuk", "packagingSRD")}
          {field("Overige kosten", "otherSRD")}
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide">Verkoop</legend>
          {field("Doel brutomarge %", "targetMarginPct", f.targetMarginPct && Number(f.targetMarginPct) < 100 ? `= ${marginToMarkup(f.targetMarginPct || 0)}% opslag (markup)` : undefined)}
          {field("Afronden op (SRD)", "roundingStep")}
          {field("Handmatige prijs", "overridePriceSRD")}
          {field("Promotiekorting %", "promoDiscountPct")}
        </fieldset>
        <p className="text-xs text-taupe">Marge = winst ÷ verkoopprijs. Opslag (markup) = winst ÷ kostprijs. Aanbevolen prijs = landed cost ÷ (1 − doelmarge). Percentages en tarieven voor douane en belasting moet u zelf controleren; het systeem gaat niet uit van vaste tarieven.</p>
      </div>
      <aside className="h-fit space-y-3 rounded-lg border bg-white p-5 text-sm lg:sticky lg:top-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide">Resultaat per stuk</h2>
        {error && <Alert variant="error">{error}</Alert>}
        {!result && !error && <p className="text-taupe">Vul een inkoopprijs in.</p>}
        {result && (
          <>
            <dl className="space-y-1">
              {([["Omgerekende inkoopprijs", result.convertedPriceSRD], ["Verzending", result.shippingPerUnit], ["Invoerrechten", result.customsPerUnit], ["Importbelasting", result.importTaxPerUnit], ["Inklaring", result.clearancePerUnit], ["Overige directe kosten", result.otherDirectPerUnit]] as const).map(([l, v]) => (
                <div key={l} className="flex justify-between"><dt className="text-taupe">{l}</dt><dd className="tabular-nums">{formatSRD(v)}</dd></div>
              ))}
              <div className="flex justify-between border-t pt-1 font-semibold"><dt>Landed cost</dt><dd>{formatSRD(result.landedCostPerUnit)}</dd></div>
              <div className="flex justify-between"><dt className="text-taupe">Aanbevolen ({result.targetMarginPct}% marge)</dt><dd>{formatSRD(result.recommendedPrice)}</dd></div>
              <div className="flex justify-between"><dt className="text-taupe">Afgerond</dt><dd>{formatSRD(result.recommendedPriceRounded)}</dd></div>
              <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>Verkoopprijs</dt><dd>{formatSRD(result.finalPrice)}</dd></div>
              <div className="flex justify-between"><dt className="text-taupe">Winst / stuk</dt><dd>{formatSRD(result.expectedProfit)}</dd></div>
              <div className="flex justify-between"><dt className="text-taupe">Werkelijke marge</dt><dd>{result.actualMarginPct}%</dd></div>
              <div className="flex justify-between"><dt className="text-taupe">Opslag (markup)</dt><dd>{result.markupPct}%</dd></div>
              {result.promoPrice && <div className="flex justify-between"><dt className="text-taupe">Promotieprijs</dt><dd>{formatSRD(result.promoPrice)} ({result.promoMarginPct}%)</dd></div>}
            </dl>
            {result.warnings.map((w) => <Alert key={w} variant="warning">{w}</Alert>)}
            <div className="flex flex-col gap-2 pt-2">
              <Button disabled={pending} onClick={() => start(async () => {
                const res = await saveCalculationAction({ ...input, productId: productId || undefined, variantId: variantId || undefined, exchangeRateId: rateOverride ? undefined : latest?.id });
                if (res.ok) toast.success(res.message ?? "Opgeslagen"); else toast.error(res.error);
              })}>Berekening opslaan</Button>
              {canApply && productId && (
                <Button variant="gold" disabled={pending} onClick={() => start(async () => {
                  if (!confirm(`Verkoopprijs van ${product?.title} wijzigen naar ${formatSRD(result!.finalPrice)}?`)) return;
                  const res = await saveCalculationAction({ ...input, productId, variantId: variantId || undefined, applyPrice: true, exchangeRateId: rateOverride ? undefined : latest?.id });
                  if (res.ok) toast.success(res.message ?? "Opgeslagen"); else toast.error(res.error);
                })}>Opslaan & prijs toepassen op product</Button>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
