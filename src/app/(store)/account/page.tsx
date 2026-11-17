import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatSRD } from "@/lib/money";
import { orderStatusLabel, paymentStatusLabel, paymentRecordLabel, statusVariant } from "@/lib/labels";

export const metadata: Metadata = { title: "Mijn bestellingen", robots: { index: false } };

export default async function AccountPage() {
  const session = await requireUser();
  const supabase = await createClient();
  const [{ data: orders }, { data: messages }] = await Promise.all([
    supabase.from("orders").select("id, order_number, status, payment_status, total, amount_verified, balance_due, created_at, has_preorder, payments(payment_number, amount, status, created_at), quotations(quote_number, status, valid_until)")
      .eq("user_id", session.userId).order("created_at", { ascending: false }).limit(50),
    supabase.from("support_messages").select("id, message, status, created_at, order_number").eq("user_id", session.userId).order("created_at", { ascending: false }).limit(10),
  ]);
  const list = orders ?? [];
  const open = list.filter((o) => !["completed", "cancelled", "expired"].includes(o.status));
  const outstanding = open.reduce((s, o) => s + Number(o.balance_due), 0);
  return (
    <div className="space-y-10">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-5"><p className="eyebrow">Lopende bestellingen</p><p className="mt-2 font-display text-3xl">{open.length}</p></div>
        <div className="rounded-lg border p-5"><p className="eyebrow">Openstaand saldo</p><p className="mt-2 font-display text-3xl">{formatSRD(outstanding)}</p></div>
        <div className="rounded-lg border p-5"><p className="eyebrow">Totaal bestellingen</p><p className="mt-2 font-display text-3xl">{list.length}</p></div>
      </div>
      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p>U heeft nog geen bestellingen geplaatst met dit account.</p>
          <Button asChild className="mt-4"><Link href="/collectie">Begin met shoppen</Link></Button>
        </div>
      ) : (
        <ul className="space-y-4">
          {list.map((o) => (
            <li key={o.id} className="rounded-lg border p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link href={`/bestelling/${o.order_number}`} className="font-medium underline-offset-4 hover:underline">{o.order_number}</Link>
                  <p className="text-xs text-taupe">{formatDate(o.created_at)}{o.has_preorder ? " · bevat pre-order" : ""}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={statusVariant(o.status)}>{orderStatusLabel[o.status]}</Badge>
                  <Badge variant={statusVariant(o.payment_status)}>{paymentStatusLabel[o.payment_status]}</Badge>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><span className="block text-xs text-taupe">Totaal</span>{formatSRD(o.total)}</div>
                <div><span className="block text-xs text-taupe">Betaald (geverifieerd)</span>{formatSRD(o.amount_verified)}</div>
                <div><span className="block text-xs text-taupe">Openstaand</span>{formatSRD(o.balance_due)}</div>
              </div>
              {(o.payments as { payment_number: string; amount: string; status: string; created_at: string }[]).length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-taupe">Betaalhistorie</summary>
                  <ul className="mt-2 space-y-1">
                    {(o.payments as { payment_number: string; amount: string; status: string; created_at: string }[]).map((p) => (
                      <li key={p.payment_number} className="flex justify-between"><span>{p.payment_number} · {formatDate(p.created_at)}</span><span>{formatSRD(p.amount)} · {paymentRecordLabel[p.status]}</span></li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {(messages ?? []).length > 0 && (
        <section>
          <h2 className="eyebrow mb-3">Uw berichten aan klantenservice</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {(messages ?? []).map((m) => <li key={m.id} className="p-4"><p>{m.message}</p><p className="mt-1 text-xs text-taupe">{formatDate(m.created_at)} · {m.status === "open" ? "Open" : m.status === "answered" ? "Beantwoord" : "Gesloten"}</p></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
