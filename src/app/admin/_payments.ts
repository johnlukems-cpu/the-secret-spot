import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PaymentRow } from "@/components/admin/payment-review";

/** Loads payments plus short-lived signed URLs for proofs (private bucket). */
export async function loadPayments(filter: { orderId?: string; open?: boolean; limit?: number }): Promise<(PaymentRow & { orders?: { order_number: string; customer_name: string; total: string; balance_due: string } })[]> {
  const supabase = await createClient();
  let q = supabase.from("payments").select("*, payment_proofs(id, storage_path, file_name, mime_type), orders(order_number, customer_name, total, balance_due)");
  if (filter.orderId) q = q.eq("order_id", filter.orderId);
  if (filter.open) q = q.in("status", ["submitted", "under_verification"]);
  const { data } = await q.order("created_at", { ascending: !!filter.open }).limit(filter.limit ?? 100);
  const rows = (data ?? []) as (Omit<PaymentRow, "proofs"> & { payment_proofs: { id: string; storage_path: string; file_name: string | null; mime_type: string | null }[]; orders: { order_number: string; customer_name: string; total: string; balance_due: string } })[];
  const paths = rows.flatMap((r) => r.payment_proofs.map((p) => p.storage_path));
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await supabase.storage.from("payment-proofs").createSignedUrls(paths, 600);
    (urls ?? []).forEach((u) => u.path && u.signedUrl && signed.set(u.path, u.signedUrl));
  }
  return rows.map(({ payment_proofs, ...r }) => ({ ...r, proofs: payment_proofs.map((p) => ({ id: p.id, url: signed.get(p.storage_path) ?? null, file_name: p.file_name, mime_type: p.mime_type })) }));
}
