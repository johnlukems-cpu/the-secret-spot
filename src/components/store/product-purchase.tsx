"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Clock, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSRD } from "@/lib/money";
import { useCart } from "./cart-provider";
import type { ProductDetail } from "@/lib/types";

export function ProductPurchase({ product, price, depositPct }: { product: ProductDetail; price: number; depositPct: number }) {
  const { add } = useCart();
  const colors = useMemo(() => [...new Set(product.variants.map((v) => v.color ?? ""))], [product.variants]);
  const [color, setColor] = useState(colors[0] ?? "");
  const sizes = product.variants.filter((v) => (v.color ?? "") === color);
  const [variantId, setVariantId] = useState<string | null>(sizes.length === 1 ? sizes[0].id : null);
  const [qty, setQty] = useState(1);
  const variant = product.variants.find((v) => v.id === variantId) ?? null;
  const isReady = product.sales_type === "ready";
  const isPre = product.sales_type === "preorder";
  const unitPrice = variant?.price_override ? Number(variant.price_override) : price;
  const maxQty = isReady ? variant?.available ?? 0 : 20;
  const soldOut = isReady && variant != null && variant.available <= 0;
  const canBuy = product.sales_type !== "coming_soon" && variant != null && !soldOut && qty <= maxQty;

  return (
    <div className="space-y-6">
      {colors.length > 1 || colors[0] ? (
        <div>
          <p className="eyebrow mb-2">Kleur: <span className="normal-case tracking-normal text-charcoal">{color || "–"}</span></p>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const hex = product.variants.find((v) => v.color === c)?.color_hex;
              return (
                <button key={c} type="button" onClick={() => { setColor(c); setVariantId(null); }}
                  aria-pressed={c === color} aria-label={c}
                  className={`h-9 w-9 rounded-full border-2 ${c === color ? "border-charcoal" : "border-transparent"} p-0.5`}>
                  <span className="block h-full w-full rounded-full border" style={{ background: hex ?? "#eee" }} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {sizes.some((v) => v.size) && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Maat</p>
            {product.size_guide && <a href="#maattabel" className="text-xs underline underline-offset-4">Maattabel</a>}
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Maat">
            {sizes.map((v) => {
              const out = isReady && v.available <= 0;
              return (
                <button key={v.id} type="button" role="radio" aria-checked={v.id === variantId} disabled={out}
                  onClick={() => { setVariantId(v.id); setQty(1); }}
                  className={`h-11 min-w-12 rounded-md border px-3 text-sm transition ${v.id === variantId ? "border-charcoal bg-charcoal text-cream" : "hover:border-charcoal"} ${out ? "cursor-not-allowed text-taupe line-through opacity-50" : ""}`}>
                  {v.size}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-md bg-cream p-4 text-sm">
        {isReady && (
          variant ? (
            variant.available > 0
              ? <p className="flex items-center gap-2 text-emerald-800"><Check className="h-4 w-4" /> Op voorraad in Suriname – nog {variant.available} beschikbaar</p>
              : <p className="text-red-700">Deze variant is uitverkocht.</p>
          ) : <p className="text-taupe">Kies een {sizes.some((v) => v.size) ? "maat" : "variant"} om de beschikbaarheid te zien.</p>
        )}
        {isPre && (
          <>
            <p className="flex items-center gap-2"><Clock className="h-4 w-4" /> Pre-order: wij kopen dit artikel in na verificatie van uw aanbetaling.</p>
            {product.estimated_delivery_text && <p className="text-taupe">Geschatte levertijd: {product.estimated_delivery_text} (schatting, geen garantie).</p>}
            <p>Aanbetaling: <strong>{depositPct}%</strong> ({formatSRD((unitPrice * qty * depositPct) / 100)}), rest bij levering.</p>
          </>
        )}
        {product.sales_type === "coming_soon" && <p>Binnenkort beschikbaar. Volg ons of neem contact op voor meer informatie.</p>}
        {isReady && <p className="flex items-center gap-2 text-taupe"><Truck className="h-4 w-4" /> {product.estimated_delivery_text ?? "Levering in heel Suriname"}</p>}
      </div>

      {product.sales_type !== "coming_soon" && (
        <div className="flex gap-3">
          <div className="flex h-12 items-center rounded-md border">
            <button type="button" className="h-full px-3" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Minder">−</button>
            <span className="w-8 text-center text-sm" aria-live="polite">{qty}</span>
            <button type="button" className="h-full px-3" onClick={() => setQty((q) => Math.min(maxQty || 1, q + 1))} aria-label="Meer" disabled={!variant || qty >= maxQty}>+</button>
          </div>
          <Button size="lg" className="flex-1" disabled={!canBuy}
            onClick={() => {
              if (!variant) return;
              add({
                variantId: variant.id, quantity: qty, productId: product.id, slug: product.slug, title: product.title,
                size: variant.size, color: variant.color, image: product.images[0]?.url ?? null, unitPrice,
                salesType: isPre ? "preorder" : "ready", maxQty: isReady ? variant.available : 20,
              });
              toast.success("Toegevoegd aan uw winkelwagen", { action: { label: "Bekijk", onClick: () => (window.location.href = "/winkelwagen") } });
            }}>
            {!variant ? "Kies een variant" : soldOut ? "Uitverkocht" : isPre ? "Pre-order plaatsen" : "In winkelwagen"}
          </Button>
        </div>
      )}
      <p className="text-xs text-taupe">Betaling via bankoverschrijving. Uw bestelling wordt pas bevestigd nadat uw betaling door The Secret Spot is geverifieerd. <Link href="/info/bestellen-en-betalen" className="underline">Meer info</Link></p>
    </div>
  );
}
