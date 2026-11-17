"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useCart, type CartItem } from "@/components/store/cart-provider";
import { OrderSummary } from "@/components/store/order-summary";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { formatSRD } from "@/lib/money";
import { priceCartAction } from "../actions";
import type { PricedCart } from "@/lib/types";

export function useServerPricing(items: CartItem[], ready: boolean, zoneId?: string, promo?: string) {
  const [priced, setPriced] = useState<PricedCart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(items.map((i) => [i.variantId, i.quantity])) + (zoneId ?? "") + (promo ?? "");
  useEffect(() => {
    if (!ready) return;
    if (!items.length) { setPriced(null); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await priceCartAction(items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })), zoneId, promo);
      if (cancelled) return;
      setLoading(false);
      if (res.ok) { setPriced(res.data); setError(null); } else { setError(res.error); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  return { priced, error, loading };
}

export function lineIssue(priced: PricedCart | null, variantId: string): string | null {
  const e = priced?.errors.find((x) => x.variant_id === variantId);
  if (!e) return null;
  if (e.code === "insufficient_stock") return e.available ? `Nog maar ${e.available} beschikbaar` : "Niet meer op voorraad";
  return "Niet meer beschikbaar";
}

function Line({ item, issue }: { item: CartItem; issue: string | null }) {
  const { setQty, remove } = useCart();
  return (
    <li className="flex gap-4 py-5">
      <Link href={`/product/${item.slug}`} className="relative h-28 w-20 shrink-0 overflow-hidden bg-cream">
        {item.image && <Image src={item.image} alt="" fill sizes="80px" className="object-cover" />}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-between gap-2">
          <Link href={`/product/${item.slug}`} className="text-sm font-medium">{item.title}</Link>
          <button onClick={() => remove(item.variantId)} aria-label="Verwijderen" className="text-taupe hover:text-charcoal"><Trash2 className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-taupe">{[item.color, item.size].filter(Boolean).join(" · ")}</p>
        {issue && <p className="mt-1 text-xs text-red-700">{issue}</p>}
        <div className="mt-auto flex items-center justify-between pt-3">
          <div className="flex h-9 items-center rounded-md border text-sm">
            <button className="px-3" onClick={() => setQty(item.variantId, item.quantity - 1)} aria-label="Minder">−</button>
            <span className="w-6 text-center">{item.quantity}</span>
            <button className="px-3" onClick={() => setQty(item.variantId, item.quantity + 1)} aria-label="Meer" disabled={item.quantity >= item.maxQty}>+</button>
          </div>
          <span className="text-sm">{formatSRD(item.unitPrice * item.quantity)}</span>
        </div>
      </div>
    </li>
  );
}

export function CartView() {
  const { items, ready } = useCart();
  const { priced, error, loading } = useServerPricing(items, ready);
  const readyItems = items.filter((i) => i.salesType === "ready");
  const preItems = items.filter((i) => i.salesType === "preorder");

  if (!ready) return <div className="container flex justify-center py-24"><Loader2 className="animate-spin" /></div>;
  if (!items.length) {
    return (
      <div className="container py-24 text-center">
        <h1 className="text-4xl">Uw winkelwagen is leeg</h1>
        <p className="mt-3 text-taupe">Ontdek onze nieuwste collectie.</p>
        <Button asChild className="mt-8" size="lg"><Link href="/collectie">Verder winkelen</Link></Button>
      </div>
    );
  }
  return (
    <div className="container py-10">
      <h1 className="text-4xl">Winkelwagen</h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px] [&>*]:min-w-0">
        <div className="space-y-8">
          {readyItems.length > 0 && (
            <section>
              <h2 className="eyebrow">Ready-to-order · direct leverbaar na verificatie</h2>
              <ul className="divide-y">{readyItems.map((i) => <Line key={i.variantId} item={i} issue={lineIssue(priced, i.variantId)} />)}</ul>
            </section>
          )}
          {preItems.length > 0 && (
            <section>
              <h2 className="eyebrow">Pre-order · wordt na aanbetaling ingekocht (levertijd is een schatting)</h2>
              <ul className="divide-y">{preItems.map((i) => <Line key={i.variantId} item={i} issue={lineIssue(priced, i.variantId)} />)}</ul>
            </section>
          )}
          {readyItems.length > 0 && preItems.length > 0 && (
            <Alert>Uw bestelling bevat zowel direct leverbare als pre-order artikelen. We leveren de bestelling in zijn geheel zodra de pre-order artikelen binnen zijn, tenzij u met ons iets anders afspreekt.</Alert>
          )}
        </div>
        <aside className="h-fit rounded-lg border p-6 lg:sticky lg:top-28">
          <h2 className="mb-4 font-sans text-sm font-semibold uppercase tracking-wide">Overzicht</h2>
          {error && <Alert variant="error" className="mb-4">{error}</Alert>}
          {priced ? <OrderSummary cart={priced} showDelivery={false} /> : <div className="flex justify-center py-6"><Loader2 className="animate-spin" /></div>}
          <p className="mt-3 text-xs text-taupe">Bezorgkosten worden berekend bij het afrekenen.</p>
          {!loading && priced && priced.errors.length === 0 ? (
            <Button asChild size="lg" className="mt-6 w-full"><Link href="/afrekenen">Afrekenen</Link></Button>
          ) : (
            <Button size="lg" className="mt-6 w-full" disabled>Afrekenen</Button>
          )}
          {priced && priced.errors.length > 0 && <p className="mt-2 text-xs text-red-700">Pas de gemarkeerde artikelen aan om verder te gaan.</p>}
        </aside>
      </div>
    </div>
  );
}
