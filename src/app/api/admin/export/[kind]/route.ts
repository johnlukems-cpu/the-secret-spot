import { NextResponse, type NextRequest } from "next/server";
import { can, getSession, type Permission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { csvResponse } from "@/lib/pdf";

const isDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const reportKeys = ["sales_by_day", "sales_by_month", "sales_by_category", "sales_by_product", "ready_vs_preorder", "popular_sizes", "popular_colors", "slow_moving", "supplier_performance", "shipment_costs"];
const perms: Record<string, Permission> = { purchasing: "purchasing.manage", finance: "finance.view", report: "reports.view", newsletter: "content.manage", orders: "orders.view" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const session = await getSession();
  const perm = perms[kind];
  if (!perm) return NextResponse.json({ error: "Onbekend" }, { status: 404 });
  if (!session || !can(session, perm)) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const supabase = await createClient();
  const stamp = new Date().toISOString().slice(0, 10);

  if (kind === "purchasing") {
    const { data, error } = await supabase.rpc("purchasing_report");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return csvResponse(((data ?? []) as Record<string, unknown>[]).map(({ order_item_ids: _ids, ...r }) => r), `inkooprapport-${stamp}.csv`);
  }
  if (kind === "newsletter") {
    const { data } = await supabase.from("newsletter_subscribers").select("email, consent_at, source").is("unsubscribed_at", null);
    return csvResponse(data ?? [], `nieuwsbrief-${stamp}.csv`);
  }
  if (kind === "orders") {
    const { data } = await supabase.from("orders").select("order_number, created_at, status, payment_status, customer_name, district, subtotal, discount_total, delivery_fee, total, deposit_required, amount_verified, balance_due").order("created_at", { ascending: false }).limit(5000);
    return csvResponse(data ?? [], `bestellingen-${stamp}.csv`);
  }
  const from = sp.get("from"); const to = sp.get("to");
  if (!isDate(from) || !isDate(to)) return NextResponse.json({ error: "Ongeldige periode" }, { status: 400 });
  if (kind === "finance") {
    const { data, error } = await supabase.rpc("financial_summary", { _from: from, _to: to });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const flat = Object.entries(data as Record<string, unknown>).filter(([k]) => k !== "period").map(([metric, value]) => ({ metric, value }));
    return csvResponse(flat, `financieel-${from}-${to}.csv`);
  }
  const key = sp.get("key") ?? "";
  if (!reportKeys.includes(key)) return NextResponse.json({ error: "Onbekend rapport" }, { status: 400 });
  const { data, error } = await supabase.rpc("report_data", { _from: from, _to: to });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return csvResponse(((data as Record<string, unknown>)[key] ?? []) as Record<string, unknown>[], `${key}-${from}-${to}.csv`);
}
