import Link from "next/link";
import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { deliveryStatusLabel, orderStatusLabel, statusVariant } from "@/lib/labels";
import { whatsappLink } from "@/lib/whatsapp";
import { recordPaymentAction } from "../orders/actions";
import { updateDeliveryAction } from "./actions";

export const metadata = { title: "Leveringen" };

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ status?: string; mine?: string; id?: string }> }) {
  const session = await requirePermission("deliveries.view");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("deliveries").select("*, orders(id, order_number, status, total, amount_verified, balance_due), delivery_payments(receipt_number, payment_id, payments(amount, method, status))");
  if (sp.id) q = q.eq("id", sp.id);
  else if (sp.status) q = q.eq("status", sp.status);
  else q = q.not("status", "in", "(delivered,failed)");
  if (sp.mine) q = q.eq("assigned_to", session.userId);
  const [{ data }, { data: staff }] = await Promise.all([
    q.order("scheduled_date", { ascending: true, nullsFirst: false }).order("created_at").limit(200),
    supabase.rpc("staff_directory"),
  ]);
  const drivers = ((staff ?? []) as { user_id: string; full_name: string | null; email: string | null; roles: string[] }[]).filter((s) => s.roles.some((r) => ["delivery_manager", "admin", "super_admin", "order_manager"].includes(r)));
  const canManage = can(session, "deliveries.manage");
  const canRecord = can(session, "payments.record");
  return (
    <div className="space-y-4">
      <PageHeader title="Leveringen" description="Leveringen ontstaan automatisch zodra alle artikelen van een bestelling beschikbaar zijn." />
      <div className="flex flex-wrap gap-2 text-xs">
        <Link href="/admin/deliveries" className="rounded-full border px-3 py-1">Open</Link>
        <Link href="/admin/deliveries?mine=1" className="rounded-full border px-3 py-1">Mijn leveringen</Link>
        {Object.entries(deliveryStatusLabel).map(([k, v]) => <Link key={k} href={`/admin/deliveries?status=${k}`} className={`rounded-full border px-3 py-1 ${sp.status === k ? "bg-charcoal text-cream" : ""}`}>{v}</Link>)}
      </div>
      {(data ?? []).length === 0 && <p className="rounded-lg border border-dashed bg-white p-10 text-center text-sm text-taupe">Geen leveringen.</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        {(data ?? []).map((d) => {
          const o = d.orders as unknown as { id: string; order_number: string; status: string; total: string; amount_verified: string; balance_due: string };
          const wa = whatsappLink(d.customer_whatsapp, `Hallo ${d.customer_name}, dit is The Secret Spot over de levering van ${o.order_number}.`);
          const receipts = (d.delivery_payments ?? []) as { receipt_number: string; payment_id: string; payments: { amount: string; method: string; status: string } }[];
          const final = ["delivered"].includes(d.status);
          return (
            <div key={d.id} className="space-y-3 rounded-lg border bg-white p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{d.delivery_number} · <Link href={`/admin/orders/${o.id}`} className="underline">{o.order_number}</Link></p>
                  <p className="text-xs text-taupe">Poging {d.attempt}{d.scheduled_date && ` · gepland ${formatDate(d.scheduled_date)}`}</p>
                </div>
                <div className="flex gap-1"><Badge variant={statusVariant(d.status)}>{deliveryStatusLabel[d.status]}</Badge><Badge variant={statusVariant(o.status)}>{orderStatusLabel[o.status]}</Badge></div>
              </div>
              <div>
                <p className="font-medium">{d.customer_name}</p>
                <p>{d.address}, {d.district}</p>
                {d.instructions && <p className="text-xs text-taupe">{d.instructions}</p>}
                <p className="text-xs">{d.customer_whatsapp} {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="ml-2 underline">WhatsApp</a>}</p>
              </div>
              <div className="flex justify-between rounded-md bg-cream p-2"><span>Te innen bij levering</span><span className="font-semibold">{formatSRD(o.balance_due)}</span></div>
              {d.failure_reason && <p className="text-xs text-red-700">{d.failure_reason}</p>}
              {receipts.map((r) => (
                <p key={r.receipt_number} className="flex items-center justify-between text-xs">
                  <span>Bon {r.receipt_number} · {formatSRD(r.payments.amount)} · {r.payments.method} · {r.payments.status}</span>
                  <a href={`/api/admin/receipts/${r.payment_id}`} className="flex items-center gap-1 underline"><FileDown className="h-3 w-3" /> bon</a>
                </p>
              ))}
              {!final && canManage && (
                <ActionForm action={updateDeliveryAction} className="grid gap-2 border-t pt-3 sm:grid-cols-2">
                  <input type="hidden" name="deliveryId" value={d.id} />
                  <select name="status" defaultValue={d.status} className="h-9 rounded-md border px-2">{Object.entries(deliveryStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  <select name="assignedTo" defaultValue={d.assigned_to ?? ""} className="h-9 rounded-md border px-2"><option value="">Bezorger…</option>{drivers.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name || s.email}</option>)}</select>
                  <input name="scheduled" type="date" defaultValue={d.scheduled_date ?? ""} className="h-9 rounded-md border px-2" aria-label="Leverdatum" />
                  <input name="deliveryCost" type="number" step="0.01" min="0" defaultValue={Number(d.delivery_cost_srd) || ""} placeholder="Interne bezorgkosten" className="h-9 rounded-md border px-2" />
                  <input name="note" placeholder="Notitie / reden (verplicht bij mislukt of verzet)" className="h-9 rounded-md border px-2 sm:col-span-2" />
                  <div><SubmitButton size="sm">Bijwerken</SubmitButton></div>
                </ActionForm>
              )}
              {canRecord && Number(o.balance_due) > 0 && !["cancelled", "expired"].includes(o.status) && (
                <ActionForm action={recordPaymentAction} className="flex flex-wrap items-end gap-2 border-t pt-3" reset>
                  <input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="deliveryId" value={d.id} />
                  <input name="amount" type="number" step="0.01" min="0.01" max={o.balance_due} defaultValue={Number(o.balance_due).toFixed(2)} className="h-9 w-28 rounded-md border px-2" aria-label="Bedrag" />
                  <select name="method" className="h-9 rounded-md border px-2"><option value="cash">Contant</option><option value="card_terminal">Pin</option><option value="bank_transfer">Overschrijving</option><option value="mobile_transfer">Mobiel</option></select>
                  <input name="reference" placeholder="Referentie" className="h-9 w-32 rounded-md border px-2" />
                  <SubmitButton size="sm" variant="gold">Betaling ontvangen</SubmitButton>
                </ActionForm>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
