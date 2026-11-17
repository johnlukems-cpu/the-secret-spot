import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { PaymentReview } from "@/components/admin/payment-review";
import { ActionForm } from "@/components/admin/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { deliveryStatusLabel, fulfilmentLabel, orderStatusLabel, paymentStatusLabel, statusVariant } from "@/lib/labels";
import { whatsappLink } from "@/lib/whatsapp";
import { loadPayments } from "../../_payments";
import { cancelOrderAdminAction, recordPaymentAction, refundAction, saveInternalNoteAction } from "../actions";

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("orders.view");
  const { id } = await params;
  const supabase = await createClient();
  const { data: o } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (!o) notFound();
  const [{ data: items }, payments, { data: deliveries }, { data: quotes }, { data: notes }, { data: refunds }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", id).order("sales_type"),
    can(session, "payments.view") ? loadPayments({ orderId: id }) : Promise.resolve([]),
    supabase.from("deliveries").select("*").eq("order_id", id).order("created_at", { ascending: false }),
    supabase.from("quotations").select("*").eq("order_id", id).order("issued_at", { ascending: false }),
    supabase.from("notifications").select("id, event, channel, status, error, created_at").eq("order_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("refunds").select("*").eq("order_id", id),
  ]);
  const wa = whatsappLink(o.customer_whatsapp, `Hallo ${o.customer_name}, dit is The Secret Spot over uw bestelling ${o.order_number}.`);
  const active = !["cancelled", "expired", "completed"].includes(o.status);

  return (
    <div className="space-y-6">
      <PageHeader title={o.order_number} description={`Geplaatst ${formatDate(o.created_at, true)}`} actions={
        <>
          <Badge variant={statusVariant(o.status)}>{orderStatusLabel[o.status]}</Badge>
          <Badge variant={statusVariant(o.payment_status)}>{paymentStatusLabel[o.payment_status]}</Badge>
          <Button asChild variant="outline" size="sm"><a href={`/api/orders/${o.order_number}/quotation`}><FileDown /> Offerte PDF</a></Button>
          {wa && <Button asChild size="sm" variant="gold"><a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp klant</a></Button>}
        </>
      } />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Table>
            <THead><TR><TH>Artikel</TH><TH>Type</TH><TH>Status</TH><TH className="text-right">Aantal</TH><TH className="text-right">Prijs</TH><TH className="text-right">Totaal</TH><TH className="text-right">Aanbet.</TH></TR></THead>
            <TBody>
              {(items ?? []).map((i) => (
                <TR key={i.id}>
                  <TD>{i.title}<div className="text-xs text-taupe">{i.sku} · {[i.color, i.size].filter(Boolean).join(" / ")}</div>
                    {i.sales_type === "preorder" && i.estimated_ready_from && <div className="text-xs text-taupe">Schatting {formatDate(i.estimated_ready_from)} – {formatDate(i.estimated_ready_to)}</div>}</TD>
                  <TD>{i.sales_type === "preorder" ? "Pre-order" : "Ready"}</TD>
                  <TD><Badge variant="outline">{fulfilmentLabel[i.fulfilment_status]}</Badge>{i.sales_type === "preorder" && <div className="text-xs text-taupe">{i.qty_allocated}/{i.quantity} toegewezen</div>}</TD>
                  <TD className="text-right">{i.quantity}</TD>
                  <TD className="text-right tabular-nums">{formatSRD(i.unit_price)}</TD>
                  <TD className="text-right tabular-nums">{formatSRD(i.line_total)}{Number(i.line_discount) > 0 && <div className="text-xs text-taupe">−{formatSRD(i.line_discount)}</div>}</TD>
                  <TD className="text-right tabular-nums">{formatSRD(i.deposit_amount)}<div className="text-xs text-taupe">{Number(i.deposit_pct)}%</div></TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {can(session, "payments.view") && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide">Betalingen</h2>
              {payments.length === 0 && <p className="text-sm text-taupe">Nog geen betalingen ingediend.</p>}
              {payments.map((p) => <PaymentReview key={p.id} p={p} canVerify={can(session, "payments.verify")} />)}
            </section>
          )}

          {(deliveries ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Leveringen</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {(deliveries ?? []).map((d) => (
                  <div key={d.id} className="flex flex-wrap justify-between gap-2">
                    <Link href={`/admin/deliveries?id=${d.id}`} className="underline">{d.delivery_number}</Link>
                    <span>{d.scheduled_date ? formatDate(d.scheduled_date) : "Niet ingepland"}</span>
                    <Badge variant={statusVariant(d.status)}>{deliveryStatusLabel[d.status]}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Notificaties</CardTitle></CardHeader>
            <CardContent>
              {(notes ?? []).length === 0 ? <p className="text-sm text-taupe">Geen notificaties.</p> : (
                <ul className="divide-y text-xs">
                  {(notes ?? []).map((n) => (
                    <li key={n.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span>{n.event} · {n.channel}</span>
                      <span className={n.status === "sent" ? "text-emerald-700" : n.status === "failed" ? "text-red-700" : "text-taupe"}>{n.status === "skipped_not_configured" ? "niet verstuurd (kanaal niet geconfigureerd)" : n.status}{n.error && n.status === "failed" ? ` – ${n.error}` : ""}</span>
                      <span className="text-taupe">{formatDate(n.created_at, true)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Bedragen</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-1.5 text-sm">
                {[["Ready-stock", o.ready_subtotal], ["Pre-order", o.preorder_subtotal], ["Subtotaal", o.subtotal], ["Korting", `-${o.discount_total}`], ["Bezorging", o.delivery_fee]].map(([l, v]) => (
                  <div key={l} className="flex justify-between"><dt className="text-taupe">{l}</dt><dd className="tabular-nums">{formatSRD(v)}</dd></div>
                ))}
                <div className="flex justify-between border-t pt-1.5 font-semibold"><dt>Totaal</dt><dd>{formatSRD(o.total)}</dd></div>
                <div className="flex justify-between"><dt className="text-taupe">Vereiste aanbetaling</dt><dd>{formatSRD(o.deposit_required)}</dd></div>
                <div className="flex justify-between text-emerald-800"><dt>Geverifieerd</dt><dd>{formatSRD(o.amount_verified)}</dd></div>
                {Number(o.amount_refunded) > 0 && <div className="flex justify-between text-red-700"><dt>Terugbetaald</dt><dd>{formatSRD(o.amount_refunded)}</dd></div>}
                <div className="flex justify-between font-semibold"><dt>Openstaand</dt><dd>{formatSRD(o.balance_due)}</dd></div>
              </dl>
              {o.payment_deadline && <p className="mt-2 text-xs text-taupe">Betaaltermijn: {formatDate(o.payment_deadline, true)}</p>}
              {(quotes ?? []).map((q) => <p key={q.id} className="mt-1 text-xs text-taupe">Offerte {q.quote_number}: {q.status}, geldig tot {formatDate(q.valid_until, true)}</p>)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Klant & bezorging</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{o.customer_name}</p>
              <p>{o.customer_whatsapp}{o.customer_email && ` · ${o.customer_email}`}</p>
              <p>{o.delivery_address}, {o.district}</p>
              {o.delivery_instructions && <p className="text-taupe">Instructies: {o.delivery_instructions}</p>}
              {o.customer_note && <p className="text-taupe">Opmerking: {o.customer_note}</p>}
              {o.promo_code && <p>Kortingscode: {o.promo_code}</p>}
              <Link href={`/admin/customers/${o.customer_id}`} className="text-xs underline">Klantprofiel</Link>
            </CardContent>
          </Card>

          {active && can(session, "payments.record") && Number(o.balance_due) > 0 && (
            <Card>
              <CardHeader><CardTitle>Betaling registreren</CardTitle></CardHeader>
              <CardContent>
                <ActionForm action={recordPaymentAction} className="space-y-2 text-sm" reset>
                  <input type="hidden" name="orderId" value={o.id} />
                  <input name="amount" type="number" step="0.01" max={o.balance_due} placeholder="Bedrag" required className="h-9 w-full rounded-md border px-2" />
                  <select name="method" className="h-9 w-full rounded-md border px-2">
                    <option value="cash">Contant (direct geverifieerd)</option><option value="card_terminal">Pinautomaat</option>
                    <option value="bank_transfer">Bankoverschrijving (vereist verificatie)</option><option value="mobile_transfer">Mobiel bankieren</option><option value="other">Anders</option>
                  </select>
                  <input name="reference" placeholder="Referentie" className="h-9 w-full rounded-md border px-2" />
                  <SubmitButton size="sm" className="w-full">Registreren</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          )}

          {can(session, "payments.refund") && Number(o.amount_verified) - Number(o.amount_refunded) > 0 && (
            <Card>
              <CardHeader><CardTitle>Terugbetaling</CardTitle></CardHeader>
              <CardContent>
                <p className="mb-2 text-xs text-taupe">Alleen volgens de gepubliceerde voorwaarden. Registreer pas nadat het geld is overgemaakt.</p>
                <ActionForm action={refundAction} className="space-y-2 text-sm" confirm="Is de terugbetaling daadwerkelijk uitgevoerd?">
                  <input type="hidden" name="orderId" value={o.id} />
                  <input name="amount" type="number" step="0.01" placeholder="Bedrag" required className="h-9 w-full rounded-md border px-2" />
                  <select name="method" className="h-9 w-full rounded-md border px-2"><option value="bank_transfer">Bankoverschrijving</option><option value="cash">Contant</option><option value="other">Anders</option></select>
                  <input name="reference" placeholder="Referentie" className="h-9 w-full rounded-md border px-2" />
                  <input name="reason" placeholder="Reden" required className="h-9 w-full rounded-md border px-2" />
                  <SubmitButton size="sm" variant="outline" className="w-full">Terugbetaling registreren</SubmitButton>
                </ActionForm>
                {(refunds ?? []).map((r) => <p key={r.id} className="mt-2 text-xs">{formatSRD(r.amount)} · {r.reason} · {formatDate(r.created_at)}</p>)}
              </CardContent>
            </Card>
          )}

          {can(session, "orders.manage") && (
            <Card>
              <CardHeader><CardTitle>Interne notitie</CardTitle></CardHeader>
              <CardContent>
                <ActionForm action={saveInternalNoteAction} className="space-y-2">
                  <input type="hidden" name="orderId" value={o.id} />
                  <textarea name="note" defaultValue={o.internal_note ?? ""} rows={3} className="w-full rounded-md border p-2 text-sm" />
                  <SubmitButton size="sm" variant="outline">Opslaan</SubmitButton>
                </ActionForm>
                {active && !["delivered", "out_for_delivery"].includes(o.status) && (
                  <ActionForm action={cancelOrderAdminAction} className="mt-4 space-y-2 border-t pt-4" confirm="Bestelling annuleren? Reserveringen worden vrijgegeven. Terugbetaling is een aparte stap.">
                    <input type="hidden" name="orderId" value={o.id} />
                    <input name="reason" required placeholder="Reden van annulering" className="h-9 w-full rounded-md border px-2 text-sm" />
                    <SubmitButton size="sm" variant="destructive">Bestelling annuleren</SubmitButton>
                  </ActionForm>
                )}
                {o.cancel_reason && <p className="mt-2 text-xs text-red-700">Geannuleerd: {o.cancel_reason}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
