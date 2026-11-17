import { formatSRD } from "@/lib/money";
import type { PricedCart } from "@/lib/types";

export function OrderSummary({ cart, showDelivery = true }: { cart: PricedCart; showDelivery?: boolean }) {
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}><dt>{label}</dt><dd>{value}</dd></div>
  );
  return (
    <dl className="space-y-2 text-sm">
      {Number(cart.ready_subtotal) > 0 && row("Ready-to-order", formatSRD(cart.ready_subtotal))}
      {Number(cart.preorder_subtotal) > 0 && row("Pre-order", formatSRD(cart.preorder_subtotal))}
      {row("Subtotaal", formatSRD(cart.subtotal))}
      {Number(cart.discount_total) > 0 && row(`Korting${cart.promo_code ? ` (${cart.promo_code})` : ""}`, `− ${formatSRD(cart.discount_total)}`)}
      {showDelivery && row(`Bezorging${cart.zone_name ? ` (${cart.zone_name})` : ""}`, cart.zone_name ? (Number(cart.delivery_fee) === 0 ? "Gratis" : formatSRD(cart.delivery_fee)) : "Kies district")}
      <div className="border-t pt-2">{row("Totaal", formatSRD(cart.total), true)}</div>
      <div className="mt-3 space-y-2 rounded-md bg-cream p-3">
        {row("Vereiste aanbetaling", formatSRD(cart.deposit_required), true)}
        {row("Openstaand na aanbetaling", formatSRD(cart.balance_after_deposit))}
        <p className="text-xs text-taupe">
          Aanbetaling: {Number(cart.ready_subtotal) > 0 && `${Number(cart.deposit_ready_pct)}% op ready-to-order`}
          {Number(cart.ready_subtotal) > 0 && Number(cart.preorder_subtotal) > 0 && " · "}
          {Number(cart.preorder_subtotal) > 0 && `${Number(cart.deposit_preorder_pct)}% op pre-order (tenzij anders vermeld)`}. Het restant betaalt u bij levering.
        </p>
      </div>
    </dl>
  );
}
