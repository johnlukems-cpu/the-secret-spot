export type SalesType = "ready" | "preorder" | "coming_soon";

export interface ProductImage { id: string; url: string; alt: string | null; color: string | null; sort_order: number }
export interface Variant { id: string; sku: string; size: string | null; color: string | null; color_hex: string | null; price_override: string | null; is_active: boolean; sort_order: number; available: number }
export interface Category { id: string; parent_id: string | null; name: string; slug: string; sort_order: number; children?: Category[] }

export interface ProductCard {
  id: string; slug: string; title: string; brand: string | null; sales_type: SalesType;
  base_price: string; promo_price: string | null; promo_starts_at: string | null; promo_ends_at: string | null;
  estimated_delivery_text: string | null; is_new_arrival: boolean; is_best_seller: boolean; is_featured: boolean;
  category_id: string | null; images: ProductImage[]; variants: Variant[]; totalAvailable: number;
}

export interface ProductDetail extends ProductCard {
  sku: string; description: string | null; size_guide: string | null; specifications: Record<string, string>;
  deposit_percentage: string | null; preorder_lead_days_min: number | null; preorder_lead_days_max: number | null;
  seo_title: string | null; seo_description: string | null; category: { name: string; slug: string } | null;
}

export interface CartLine { variantId: string; quantity: number }

export interface PricedLine {
  product_id: string; variant_id: string; sku: string; title: string; slug: string; size: string | null; color: string | null;
  sales_type: "ready" | "preorder"; quantity: number; unit_price: string; gross_total: string; line_discount: string;
  line_total: string; deposit_pct: string; deposit_amount: string; available: number; estimated_delivery_text: string | null;
}

export interface PricedCart {
  lines: PricedLine[]; errors: { variant_id?: string; code: string; available?: number }[];
  ready_subtotal: string; preorder_subtotal: string; subtotal: string; discount_total: string; delivery_fee: string;
  total: string; deposit_required: string; balance_after_deposit: string; deposit_ready_pct: string; deposit_preorder_pct: string;
  promo_code: string | null; promo_message: string | null; zone_name: string | null;
}
