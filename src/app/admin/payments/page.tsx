import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { PaymentReview } from "@/components/admin/payment-review";
import { can, requirePermission } from "@/lib/auth";
import { formatSRD } from "@/lib/money";
import { loadPayments } from "../_payments";

export const metadata = { title: "Betalingen" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const session = await requirePermission("payments.view");
  const { all } = await searchParams;
  const rows = await loadPayments({ open: !all, limit: all ? 200 : 100 });
  const canVerify = can(session, "payments.verify");
  return (
    <div>
      <PageHeader title={all ? "Alle betalingen" : "Verificatiewachtrij"}
        description="Controleer elke betaling op het werkelijke bankafschrift voordat u goedkeurt. Alleen geverifieerde betalingen tellen mee in saldi."
        actions={<Link href={all ? "/admin/payments" : "/admin/payments?all=1"} className="text-sm underline">{all ? "Toon wachtrij" : "Toon alle betalingen"}</Link>} />
      {rows.length === 0 ? <p className="rounded-lg border border-dashed bg-white p-10 text-center text-sm text-taupe">{all ? "Nog geen betalingen." : "Geen betalingen te verifiëren. 🎉"}</p> : (
        <div className="space-y-3">
          {rows.map((p) => (
            <PaymentReview key={p.id} p={p} canVerify={canVerify} orderLabel={p.orders && (
              <Link href={`/admin/orders/${p.order_id}`} className="ml-1 text-xs underline">{p.orders.order_number} · {p.orders.customer_name} · totaal {formatSRD(p.orders.total)} · open {formatSRD(p.orders.balance_due)}</Link>
            )} />
          ))}
        </div>
      )}
    </div>
  );
}
