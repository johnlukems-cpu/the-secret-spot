import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, FileDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { loadTrackedOrder } from "@/lib/data/orders";
import { getPublicSettings } from "@/lib/data/catalog";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { fulfilmentLabel, orderStatusLabel, paymentRecordLabel, paymentStatusLabel, statusVariant, deliveryStatusLabel } from "@/lib/labels";
import { PaymentForm } from "./payment-form";
import { CancelForm } from "./cancel-form";
import { TrackForm } from "../../volg-bestelling/track-form";

export const metadata: Metadata = { title: "Uw bestelling", robots: { index: false, follow: false } };

const steps = ["awaiting_deposit", "confirmed", "ready_for_delivery", "out_for_delivery", "completed"];

export default async function OrderPage({ params, searchParams }: { params: Promise<{ orderNumber: string }>; searchParams: Promise<{ t?: string; nieuw?: string }> }) {
  const { orderNumber } = await params;
  const sp = await searchParams;
  const { data, token } = await loadTrackedOrder(orderNumber, sp.t);
  if (!data) {
    return (
      <div className="container max-w-lg py-16">
        <h1 className="text-3xl">Bestelling bekijken</h1>
        <p className="mt-2 text-sm text-taupe">Bevestig uw WhatsApp-nummer om bestelling {orderNumber.toUpperCase()} te bekijken.</p>
        <div className="mt-6"><TrackForm defaultOrderNumber={orderNumber.toUpperCase()} /></div>
      </div>
    );
  }
  const { order: o, items, payments, quotation, delivery } = data;
  const supabase = await createClient();
  const [{ data: banks }, settings] = await Promise.all([supabase.rpc("checkout_bank_instructions"), getPublicSettings()]);
  const bankList = (banks ?? []) as { bank_name: string; account_holder: string; account_number: string; currency: string; instructions: string | null; reference_format: string }[];
  const readyItems = items.filter((i) => i.sales_type === "ready");
  const preItems = items.filter((i) => i.sales_type === "preorder");
  const payable = !["cancelled", "expired", "completed"].includes(o.status) && Number(o.balance_due) > 0;
  const depositOutstanding = Math.max(0, Number(o.deposit_required) - Number(o.amount_verified));
  const pendingPayments = payments.filter((p) => ["submitted", "under_verification"].includes(p.status));
  const stepIndex = Math.max(0, steps.findIndex((s) => s === (o.status === "payment_review" ? "awaiting_deposit" : ["purchasing", "in_transit"].includes(o.status) ? "confirmed" : o.status === "delivered" ? "out_for_delivery" : o.status)));
  const pdfQuery = token ? `?t=${encodeURIComponent(token)}` : "";

  return (
    <div className="container max-w-5xl py-10">
      {sp.nieuw && (
        <Alert variant="success" className="mb-8 flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <span>Bedankt voor uw bestelling! Bewaar deze pagina (of uw bestelnummer): hier vindt u de betaalinstructies en volgt u uw bestelling.</span>
        </Alert>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Bestelling</p>
          <h1 className="text-4xl">{o.order_number}</h1>
          <p className="mt-1 text-sm text-taupe">Geplaatst op {formatDate(o.created_at, true)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={statusVariant(o.status)}>{orderStatusLabel[o.status]}</Badge>
          <Badge variant={statusVariant(o.payment_status)}>{paymentStatusLabel[o.payment_status]}</Badge>
        </div>
      </div>

      {!["cancelled", "expired"].includes(o.status) && (
        <ol className="mt-8 grid grid-cols-5 gap-1 text-[10px] uppercase tracking-wide sm:text-xs" aria-label="Voortgang">
          {["Aanbetaling", "Bevestigd", "Klaar", "Onderweg", "Afgerond"].map((label, i) => (
            <li key={label} className={`border-t-2 pt-2 ${i <= stepIndex ? "border-charcoal text-charcoal" : "border-border text-taupe"}`}>{label}</li>
          ))}
        </ol>
      )}
      {o.status === "expired" && <Alert variant="warning" className="mt-6">Deze bestelling is verlopen omdat de aanbetaling niet op tijd is ontvangen. De gereserveerde artikelen zijn vrijgegeven. Neem contact met ons op als u wel heeft betaald.</Alert>}
      {o.status === "cancelled" && <Alert variant="warning" className="mt-6">Deze bestelling is geannuleerd.</Alert>}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_360px] [&>*]:min-w-0">
        <div className="space-y-10">
          {payable && (
            <section className="rounded-lg border p-6">
              <h2 className="text-2xl">{depositOutstanding > 0 ? "Aanbetaling voldoen" : "Openstaand saldo"}</h2>
              <p className="mt-2 text-sm">
                {depositOutstanding > 0
                  ? <>Maak <strong>{formatSRD(depositOutstanding)}</strong> over{o.payment_deadline && <> vóór <strong>{formatDate(o.payment_deadline, true)}</strong></>}. Vermeld uw bestelnummer <strong>{o.order_number}</strong> als omschrijving.</>
                  : <>Het resterende bedrag van <strong>{formatSRD(o.balance_due)}</strong> betaalt u bij levering, of vooraf via overschrijving.</>}
              </p>
              {bankList.length ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {bankList.map((b) => (
                    <div key={b.account_number} className="rounded-md bg-cream p-4 text-sm">
                      <p className="font-semibold">{b.bank_name}</p>
                      <p>Ten name van: {b.account_holder}</p>
                      <p>Rekeningnummer: <span className="font-mono">{b.account_number}</span> ({b.currency})</p>
                      <p>Omschrijving: <span className="font-mono">{b.reference_format.replace("{order_number}", o.order_number)}</span></p>
                      {b.instructions && <p className="mt-2 text-taupe">{b.instructions}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <Alert variant="warning" className="mt-4">De bankgegevens zijn nog niet ingesteld. Neem contact op met The Secret Spot voor de betaalinstructies.</Alert>
              )}
              <p className="mt-4 text-sm font-medium">{String(settings.payment_disclaimer ?? "Uw bestelling wordt pas bevestigd nadat uw betaling door The Secret Spot is geverifieerd.")}</p>
              {pendingPayments.length > 0 && <Alert className="mt-4">U heeft {pendingPayments.length} betaling(en) doorgegeven die nog gecontroleerd worden.</Alert>}
              <div className="mt-6 border-t pt-6">
                <h3 className="mb-4 font-sans text-sm font-semibold uppercase tracking-wide">Betaling doorgeven</h3>
                <PaymentForm orderNumber={o.order_number} token={sp.t} suggestedAmount={depositOutstanding > 0 ? depositOutstanding : Number(o.balance_due)} referenceHint={o.order_number} />
              </div>
            </section>
          )}

          {[["Direct leverbaar", readyItems], ["Pre-order", preItems]].map(([label, list]) =>
            (list as typeof items).length ? (
              <section key={label as string}>
                <h2 className="eyebrow mb-3">{label as string}</h2>
                <ul className="divide-y rounded-lg border">
                  {(list as typeof items).map((i, idx) => (
                    <li key={idx} className="flex justify-between gap-4 p-4 text-sm">
                      <div>
                        <p className="font-medium">{i.quantity}× {i.title}</p>
                        <p className="text-xs text-taupe">{[i.color, i.size].filter(Boolean).join(" · ")} · {i.sku}</p>
                        <p className="mt-1 text-xs">{fulfilmentLabel[i.fulfilment_status] ?? i.fulfilment_status}</p>
                        {i.sales_type === "preorder" && i.estimated_ready_from && (
                          <p className="text-xs text-taupe">Geschat beschikbaar: {formatDate(i.estimated_ready_from)} – {formatDate(i.estimated_ready_to)} (schatting)</p>
                        )}
                      </div>
                      <span className="shrink-0">{formatSRD(i.line_total)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null)}

          {payments.length > 0 && (
            <section>
              <h2 className="eyebrow mb-3">Betalingen</h2>
              <ul className="divide-y rounded-lg border text-sm">
                {payments.map((p) => (
                  <li key={p.payment_number} className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <span>{p.payment_number} · {formatDate(p.created_at)} · ref. {p.reference ?? "–"}</span>
                    <span className="flex items-center gap-2">{formatSRD(p.amount)} <Badge variant={statusVariant(p.status)}>{paymentRecordLabel[p.status]}</Badge></span>
                    {p.rejection_reason && <span className="w-full text-xs text-red-700">Reden: {p.rejection_reason}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="h-fit space-y-6 rounded-lg border p-6">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt>Subtotaal</dt><dd>{formatSRD(o.subtotal)}</dd></div>
            {Number(o.discount_total) > 0 && <div className="flex justify-between"><dt>Korting</dt><dd>− {formatSRD(o.discount_total)}</dd></div>}
            <div className="flex justify-between"><dt>Bezorging</dt><dd>{formatSRD(o.delivery_fee)}</dd></div>
            <div className="flex justify-between border-t pt-2 font-semibold"><dt>Totaal</dt><dd>{formatSRD(o.total)}</dd></div>
            <div className="flex justify-between"><dt>Vereiste aanbetaling</dt><dd>{formatSRD(o.deposit_required)}</dd></div>
            <div className="flex justify-between text-emerald-800"><dt>Geverifieerd betaald</dt><dd>{formatSRD(o.amount_verified)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Openstaand saldo</dt><dd>{formatSRD(o.balance_due)}</dd></div>
          </dl>
          <div className="text-sm">
            <p className="eyebrow mb-1">Bezorgadres</p>
            <p>{o.customer_name}<br />{o.delivery_address}<br />{o.district}</p>
            {delivery && <p className="mt-2">Levering: {deliveryStatusLabel[delivery.status]}{delivery.scheduled_date && ` · ${formatDate(delivery.scheduled_date)}`}</p>}
          </div>
          {quotation && (
            <div className="space-y-2 text-sm">
              <p>Offerte {quotation.quote_number} · geldig tot {formatDate(quotation.valid_until, true)}</p>
              <Button asChild variant="outline" size="sm" className="w-full">
                <a href={`/api/orders/${o.order_number}/quotation${pdfQuery}`}><FileDown /> Offerte / besteloverzicht (PDF)</a>
              </Button>
            </div>
          )}
          {["awaiting_deposit", "payment_review"].includes(o.status) && Number(o.amount_verified) === 0 && <CancelForm orderNumber={o.order_number} />}
          <p className="text-xs text-taupe">Vragen? <Link href="/contact" className="underline">Neem contact op</Link> en vermeld uw bestelnummer.</p>
        </aside>
      </div>
    </div>
  );
}
