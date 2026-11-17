import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export interface TrackedOrder {
  order: {
    order_number: string; status: string; payment_status: string; customer_name: string; district: string; delivery_address: string;
    subtotal: string; discount_total: string; delivery_fee: string; total: string; deposit_required: string; amount_verified: string;
    balance_due: string; payment_deadline: string | null; quote_valid_until: string | null; has_preorder: boolean; has_ready: boolean; created_at: string; currency: string;
  };
  items: { title: string; sku: string; size: string | null; color: string | null; sales_type: "ready" | "preorder"; quantity: number; unit_price: string; line_total: string; deposit_amount: string; fulfilment_status: string; estimated_ready_from: string | null; estimated_ready_to: string | null }[];
  payments: { payment_number: string; kind: string; amount: string; status: string; reference: string | null; created_at: string; rejection_reason: string | null }[];
  quotation: { quote_number: string; status: string; valid_until: string } | null;
  delivery: { status: string; scheduled_date: string | null; delivered_at: string | null } | null;
}

/**
 * Loads an order for the current visitor: account owner, guest token (URL or
 * device cookie) or a phone-verified lookup from the tracking form.
 */
export async function loadTrackedOrder(orderNumber: string, urlToken?: string): Promise<{ data: TrackedOrder | null; token?: string }> {
  if (!isSupabaseConfigured()) return { data: null };
  const num = orderNumber.toUpperCase();
  const jar = await cookies();
  const token = urlToken || jar.get(`tss_o_${num}`)?.value;
  const phone = jar.get(`tss_w_${num}`)?.value;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("track_order", { _order_number: num, _token: token ?? null, _whatsapp: phone ?? null });
  if (error || !data) return { data: null };
  return { data: data as TrackedOrder, token };
}
