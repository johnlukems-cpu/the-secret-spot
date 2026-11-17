"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** Display snapshot only – prices are always recalculated on the server. */
export interface CartItem {
  variantId: string; quantity: number; productId: string; slug: string; title: string;
  size: string | null; color: string | null; image: string | null; unitPrice: number; salesType: "ready" | "preorder"; maxQty: number;
}

interface CartCtx {
  items: CartItem[]; count: number; ready: boolean;
  add: (item: CartItem) => void; setQty: (variantId: string, qty: number) => void; remove: (variantId: string) => void; clear: () => void;
}

const Ctx = createContext<CartCtx | null>(null);
const KEY = "tss_cart_v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch { /* storage unavailable */ }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ }
  }, [items, ready]);

  const add = useCallback((item: CartItem) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.variantId === item.variantId);
      if (existing) {
        return prev.map((i) => i.variantId === item.variantId ? { ...i, quantity: Math.min(i.quantity + item.quantity, item.maxQty, 99) } : i);
      }
      return [...prev, { ...item, quantity: Math.min(item.quantity, item.maxQty, 99) }];
    });
  }, []);
  const setQty = useCallback((variantId: string, qty: number) =>
    setItems((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.max(1, Math.min(qty, i.maxQty, 99)) } : i))), []);
  const remove = useCallback((variantId: string) => setItems((prev) => prev.filter((i) => i.variantId !== variantId)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(() => ({ items, count: items.reduce((s, i) => s + i.quantity, 0), ready, add, setQty, remove, clear }), [items, ready, add, setQty, remove, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
