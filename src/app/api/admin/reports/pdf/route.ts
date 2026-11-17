import { NextResponse, type NextRequest } from "next/server";
import { can, getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DocBuilder, pdfResponse } from "@/lib/pdf";
import { formatSRD } from "@/lib/money";

const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !can(session, "reports.view")) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  const from = req.nextUrl.searchParams.get("from"); const to = req.nextUrl.searchParams.get("to");
  if (!isDate(from) || !isDate(to)) return NextResponse.json({ error: "Ongeldige periode" }, { status: 400 });
  const supabase = await createClient();
  const [{ data: r, error }, fin] = await Promise.all([
    supabase.rpc("report_data", { _from: from, _to: to }),
    can(session, "finance.view") ? supabase.rpc("financial_summary", { _from: from, _to: to }) : Promise.resolve({ data: null }),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const R = r as Record<string, Record<string, unknown>[]>;
  const d = await DocBuilder.create("Rapportage", `Periode ${from} t/m ${to} · gegenereerd ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
  if (fin.data) {
    const f = fin.data as Record<string, number>;
    d.text("Financieel (omzet erkend bij levering)", { bold: true });
    d.kv([["Bruto omzet", formatSRD(f.gross_sales)], ["Kostprijs verkopen", formatSRD(f.cost_of_goods_sold)], ["Brutowinst", formatSRD(f.gross_profit)], ["Bedrijfs- en bezorgkosten", formatSRD(Number(f.operating_expenses) + Number(f.delivery_expenses))], ["Netto operationeel resultaat", formatSRD(f.net_operating_result)]], { boldLast: true });
    d.spacer();
  }
  d.text("Omzet per categorie", { bold: true });
  d.table(["Categorie", "Stuks", "Omzet"], (R.sales_by_category ?? []).map((x) => [String(x.category), String(x.units), formatSRD(Number(x.revenue))]), [60, 15, 25], [1, 2]);
  d.text("Top producten", { bold: true });
  d.table(["Product", "Stuks", "Omzet", "Winst"], (R.sales_by_product ?? []).slice(0, 25).map((x) => [String(x.title), String(x.units), formatSRD(Number(x.revenue)), x.cost_known ? formatSRD(Number(x.profit)) : "onvolledig"]), [50, 12, 19, 19], [1, 2, 3]);
  d.text("Ready-stock vs pre-order", { bold: true });
  d.table(["Type", "Bestellingen", "Stuks", "Omzet"], (R.ready_vs_preorder ?? []).map((x) => [x.sales_type === "ready" ? "Ready-stock" : "Pre-order", String(x.orders), String(x.units), formatSRD(Number(x.revenue))]), [40, 20, 15, 25], [1, 2, 3]);
  d.text("Langzaam lopende voorraad", { bold: true });
  d.table(["SKU", "Product", "Voorraad"], (R.slow_moving ?? []).slice(0, 30).map((x) => [String(x.sku), String(x.title), String(x.on_hand)]), [25, 60, 15], [2]);
  return pdfResponse(await d.bytes(), `rapport-${from}-${to}.pdf`);
}
