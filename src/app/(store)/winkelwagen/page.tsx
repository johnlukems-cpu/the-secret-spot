import type { Metadata } from "next";
import { CartView } from "./cart-view";

export const metadata: Metadata = { title: "Winkelwagen", robots: { index: false } };
export default function CartPage() {
  return <CartView />;
}
