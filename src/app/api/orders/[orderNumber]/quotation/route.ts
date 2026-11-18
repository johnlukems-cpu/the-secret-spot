import { NextResponse, type NextRequest } from "next/server";
import { loadTrackedOrder } from "@/lib/data/orders";
import { createClient } from "@/lib/supabase/server";
import { getPublicSettings } from "@/lib/data/catalog";
import { DocBuilder, pdfResponse } from "@/lib/pdf";
import { formatDate, formatSRD } from "@/lib/money";
import { orderStatusLabel, paymentStatusLabel } from "@/lib/labels";

/** Quotation / order summary PDF. Access: account owner, guest token, verified phone, or staff. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;
  const token = req.nextUrl.searchParams.get("t") ?? undefined;
  const { data } = await loadTrackedOrder(orderNumber, token);
  if (!data) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  const { order: o, items, quotation } = data;
  const supabase = await createClient();
  const [{ data: banks }, settings] = await Promise.all([supabase.rpc("checkout_bank_instructions"), getPublicSettings()]);

  const d = await DocBuilder.create(quotation ? `Offerte / besteloverzicht ${quotation.quote_number}` : `Besteloverzicht ${o.order_number}`,
    `Bestelling ${o.order_number} · ${formatDate(o.created_at, true)}${quotation ? ` · geldig tot ${formatDate(quotation.valid_until, true)}` : ""}`);
  d.text(`${o.customer_name}\n${o.delivery_address}\n${o.district}`, { size: 10 });
  d.spacer();
  d.text(`Status: ${orderStatusLabel[o.status]} · Betaling: ${paymentStatusLabel[o.payment_status]}`, { size: 9 });
  d.spacer(6);
  for (const [label, type] of [["Direct leverbaar (ready-to-order)", "ready"], ["Pre-order (levertijd is een schatting)", "preorder"]] as const) {
    const list = items.filter((i) => i.sales_type === type);
    if (!list.length) continue;
    d.text(label, { bold: true, size: 10 });
    d.table(["Artikel", "Variant", "Aantal", "Prijs", "Totaal", "Aanbetaling"],
      list.map((i) => [i.title, [i.color, i.size].filter(Boolean).join(" / "), String(i.quantity), formatSRD(i.unit_price), formatSRD(i.line_total), formatSRD(i.deposit_amount)]),
      [34, 16, 8, 14, 14, 14], [2, 3, 4, 5]);
    if (type === "preorder") {
      const est = list.filter((i) => i.estimated_ready_from).map((i) => `${i.title}: ${formatDate(i.estimated_ready_from)} – ${formatDate(i.estimated_ready_to)}`);
      if (est.length) d.text(`Geschatte beschikbaarheid: ${est.join("; ")}`, { size: 8 });
    }
    d.spacer(6);
  }
  d.kv([
    ["Subtotaal", formatSRD(o.subtotal)],
    ["Korting", `- ${formatSRD(o.discount_total)}`],
    ["Bezorging", formatSRD(o.delivery_fee)],
    ["Totaal", formatSRD(o.total)],
    ["Vereiste aanbetaling", formatSRD(o.deposit_required)],
    ["Geverifieerd betaald", formatSRD(o.amount_verified)],
    ["Openstaand saldo", formatSRD(o.balance_due)],
  ], { boldLast: true });
  d.spacer();
  const bankList = (banks ?? []) as { bank_name: string; account_holder: string; account_number: string; currency: string; reference_format: string; instructions: string | null }[];
  if (bankList.length) {
    d.text("Betaalinstructies", { bold: true });
    bankList.forEach((b) => d.text(`${b.bank_name} · t.n.v. ${b.account_holder} · ${b.account_number} (${b.currency}) · omschrijving: ${b.reference_format.replace("{order_number}", o.order_number)}${b.instructions ? `\n${b.instructions}` : ""}`, { size: 9 }));
  }
  if (o.payment_deadline) d.text(`Betaal de aanbetaling uiterlijk ${formatDate(o.payment_deadline, true)}.`, { size: 9 });
  d.spacer(6);
  d.text(String(settings.payment_disclaimer ?? "Uw bestelling wordt pas bevestigd nadat uw betaling door The Secret Girl is geverifieerd."), { bold: true, size: 9 });
  if (settings.cancellation_policy) { d.spacer(6); d.text("Voorwaarden", { bold: true, size: 9 }); d.text(String(settings.cancellation_policy), { size: 8 }); }
  return pdfResponse(await d.bytes(), `${quotation?.quote_number ?? o.order_number}.pdf`);
}
