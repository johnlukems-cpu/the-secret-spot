import { NextResponse } from "next/server";
import { can, getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DocBuilder, pdfResponse } from "@/lib/pdf";
import { formatDate, formatMoney, type Currency } from "@/lib/money";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !can(session, "purchasing.manage")) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  const { id } = await params;
  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders").select("*, suppliers(name, contact_person, email, phone, platform), purchase_order_items(quantity, unit_cost, line_total, description, product_variants(sku, size, color, products(title)))").eq("id", id).maybeSingle();
  if (!po) return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  const s = po.suppliers as { name: string; contact_person: string | null; email: string | null; phone: string | null; platform: string | null };
  const cur = po.currency as Currency;
  const lines = po.purchase_order_items as { quantity: number; unit_cost: string; line_total: string; product_variants: { sku: string; size: string | null; color: string | null; products: { title: string } } }[];
  const d = await DocBuilder.create(`Purchase Order ${po.po_number}`, `${po.order_date ? `Date ${formatDate(po.order_date)} · ` : ""}Currency ${cur}`);
  d.text(`Supplier: ${s.name}${s.contact_person ? `\nAttn: ${s.contact_person}` : ""}${s.email ? `\n${s.email}` : ""}${s.phone ? `\n${s.phone}` : ""}`);
  d.spacer();
  d.table(["Product", "SKU", "Size", "Colour", "Qty", "Unit price", "Total"],
    lines.map((l) => [l.product_variants.products.title, l.product_variants.sku, l.product_variants.size ?? "-", l.product_variants.color ?? "-", String(l.quantity), formatMoney(l.unit_cost, cur), formatMoney(l.line_total, cur)]),
    [28, 18, 8, 10, 6, 14, 14], [4, 5, 6]);
  d.kv([["Total units", String(lines.reduce((a, l) => a + l.quantity, 0))], ["Order total", formatMoney(lines.reduce((a, l) => a + Number(l.line_total), 0), cur)]], { boldLast: true });
  if (po.expected_ship_date) d.text(`Requested ship date: ${formatDate(po.expected_ship_date)}`, { size: 9 });
  if (po.notes) { d.spacer(); d.text(po.notes, { size: 9 }); }
  return pdfResponse(await d.bytes(), `${po.po_number}.pdf`);
}
