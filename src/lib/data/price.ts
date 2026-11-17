/** Display price (client & server safe). The database computes the authoritative price at checkout. */
export function effectivePrice(p: { base_price: string; promo_price: string | null; promo_starts_at: string | null; promo_ends_at: string | null }): { price: number; compareAt: number | null } {
  const now = Date.now();
  const promoActive = p.promo_price != null
    && (!p.promo_starts_at || new Date(p.promo_starts_at).getTime() <= now)
    && (!p.promo_ends_at || new Date(p.promo_ends_at).getTime() > now);
  return promoActive ? { price: Number(p.promo_price), compareAt: Number(p.base_price) } : { price: Number(p.base_price), compareAt: null };
}
