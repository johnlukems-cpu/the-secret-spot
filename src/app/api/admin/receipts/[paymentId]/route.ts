import { NextResponse } from "next/server";
import { can, getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DocBuilder, pdfResponse } from "@/lib/pdf";
import { formatDate, formatSRD } from "@/lib/money";

export async function GET(_req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const session = await getSession();
  if (!session || !(can(session, "payments.view") || can(session, "deliveries.view"))) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  const { paymentId } = await params;
  const supabase = await createClient();
  const { data: p } = await supabase.from("payments").select("*, orders(order_number, customer_name, total, amount_verified, balance_due, delivery_address, district), delivery_payments(receipt_number, deliveries(delivery_number))").eq("id", paymentId).maybeSingle();
  if (!p) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  const o = p.orders as { order_number: string; customer_name: string; total: string; amount_verified: string; balance_due: string; delivery_address: string; district: string };
  const dp = (p.delivery_payments as { receipt_number: string; deliveries: { delivery_number: string } }[])[0];
  const d = await DocBuilder.create(`Ontvangstbewijs ${dp?.receipt_number ?? p.payment_number}`, `${formatDate(p.verified_at ?? p.created_at, true)}${dp ? ` · levering ${dp.deliveries.delivery_number}` : ""}`);
  d.text(`${o.customer_name}\n${o.delivery_address}, ${o.district}`);
  d.spacer();
  d.kv([
    ["Bestelling", o.order_number],
    ["Betaling", p.payment_number],
    ["Methode", p.method],
    ["Referentie", p.reference ?? "-"],
    ["Status", p.status === "verified" ? "Ontvangen / geverifieerd" : "Ingediend – wacht op verificatie"],
    ["Ontvangen bedrag", formatSRD(p.amount)],
  ], { boldLast: true });
  d.spacer();
  d.kv([["Totaal bestelling", formatSRD(o.total)], ["Totaal geverifieerd betaald", formatSRD(o.amount_verified)], ["Openstaand saldo", formatSRD(o.balance_due)]], { boldLast: true });
  d.spacer(20);
  d.text("Handtekening klant: ______________________        Ontvangen door: ______________________", { size: 9 });
  return pdfResponse(await d.bytes(), `ontvangstbewijs-${dp?.receipt_number ?? p.payment_number}.pdf`);
}
