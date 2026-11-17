import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";

export const metadata = { title: "Offertes" };

export default async function QuotationsPage() {
  await requirePermission("orders.view");
  const supabase = await createClient();
  const { data } = await supabase.from("quotations").select("id, quote_number, status, total, deposit_required, valid_until, issued_at, orders(id, order_number, customer_name)").order("issued_at", { ascending: false }).limit(200);
  return (
    <div>
      <PageHeader title="Offertes" description="Elke bestelling krijgt automatisch een offerte/besteloverzicht met geldigheidsduur. Verlopen offertes worden door het onderhoudsproces gemarkeerd." />
      <Table>
        <THead><TR><TH>Offerte</TH><TH>Bestelling</TH><TH>Status</TH><TH className="text-right">Totaal</TH><TH className="text-right">Aanbetaling</TH><TH>Geldig tot</TH><TH></TH></TR></THead>
        <TBody>
          {(data ?? []).length === 0 && <EmptyRow cols={7}>Nog geen offertes.</EmptyRow>}
          {(data ?? []).map((q) => {
            const o = q.orders as unknown as { id: string; order_number: string; customer_name: string };
            const expiredSoon = q.status === "active" && new Date(q.valid_until) < new Date();
            return (
              <TR key={q.id}>
                <TD className="font-medium">{q.quote_number}<div className="text-xs text-taupe">{formatDate(q.issued_at)}</div></TD>
                <TD><Link href={`/admin/orders/${o.id}`} className="underline">{o.order_number}</Link><div className="text-xs text-taupe">{o.customer_name}</div></TD>
                <TD><Badge variant={q.status === "accepted" ? "success" : q.status === "active" ? (expiredSoon ? "warning" : "info") : "danger"}>{expiredSoon ? "verlopen (onverwerkt)" : q.status}</Badge></TD>
                <TD className="text-right">{formatSRD(q.total)}</TD><TD className="text-right">{formatSRD(q.deposit_required)}</TD>
                <TD className="text-xs">{formatDate(q.valid_until, true)}</TD>
                <TD><a className="text-xs underline" href={`/api/orders/${o.order_number}/quotation`}>PDF</a></TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
