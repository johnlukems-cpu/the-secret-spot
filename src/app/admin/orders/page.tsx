import Link from "next/link";
import { PageHeader } from "@/components/admin/page-header";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { requirePermission, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatSRD } from "@/lib/money";
import { orderStatusLabel, paymentStatusLabel, statusVariant } from "@/lib/labels";
import { runMaintenanceAction } from "./actions";

export const metadata = { title: "Bestellingen" };
const PAGE = 30;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; type?: string; page?: string }> }) {
  const session = await requirePermission("orders.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createClient();
  let q = supabase.from("orders").select("id, order_number, customer_name, customer_whatsapp, district, status, payment_status, total, amount_verified, balance_due, has_preorder, has_ready, created_at", { count: "exact" });
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.type === "preorder") q = q.eq("has_preorder", true);
  if (sp.type === "ready") q = q.eq("has_preorder", false);
  if (sp.q) {
    const t = sp.q.replace(/[%,()]/g, "").trim();
    q = q.or(`order_number.ilike.%${t}%,customer_name.ilike.%${t}%,customer_whatsapp.ilike.%${t}%`);
  }
  const { data, count } = await q.order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(sp.status ? { status: sp.status } : {}), ...(sp.q ? { q: sp.q } : {}), ...(sp.type ? { type: sp.type } : {}), page: String(p) })}`;

  return (
    <div>
      <PageHeader title="Bestellingen" description={`${count ?? 0} bestellingen`} actions={can(session, "orders.manage") && (
        <ActionForm action={runMaintenanceAction} successMessage="Onderhoud uitgevoerd">
          <SubmitButton variant="outline" size="sm">Verlopen betalingen verwerken</SubmitButton>
        </ActionForm>
      )} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Zoek bestelnr, naam, WhatsApp" className="h-9 w-64 rounded-md border px-3 text-sm" />
        <select name="status" defaultValue={sp.status ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Alle statussen</option>
          {Object.entries(orderStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="type" defaultValue={sp.type ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Alle typen</option><option value="ready">Alleen ready-stock</option><option value="preorder">Met pre-order</option>
        </select>
        <Button size="sm" type="submit">Filteren</Button>
      </form>
      <Table>
        <THead><TR><TH>Bestelling</TH><TH>Klant</TH><TH>Status</TH><TH>Betaling</TH><TH className="text-right">Totaal</TH><TH className="text-right">Geverifieerd</TH><TH className="text-right">Openstaand</TH></TR></THead>
        <TBody>
          {(data ?? []).length === 0 && <EmptyRow cols={7}>Geen bestellingen gevonden.</EmptyRow>}
          {(data ?? []).map((o) => (
            <TR key={o.id}>
              <TD><Link href={`/admin/orders/${o.id}`} className="font-medium underline-offset-4 hover:underline">{o.order_number}</Link><div className="text-xs text-taupe">{formatDate(o.created_at, true)} · {o.has_preorder ? (o.has_ready ? "Gemengd" : "Pre-order") : "Ready"}</div></TD>
              <TD>{o.customer_name}<div className="text-xs text-taupe">{o.customer_whatsapp} · {o.district}</div></TD>
              <TD><Badge variant={statusVariant(o.status)}>{orderStatusLabel[o.status]}</Badge></TD>
              <TD><Badge variant={statusVariant(o.payment_status)}>{paymentStatusLabel[o.payment_status]}</Badge></TD>
              <TD className="text-right tabular-nums">{formatSRD(o.total)}</TD>
              <TD className="text-right tabular-nums">{formatSRD(o.amount_verified)}</TD>
              <TD className="text-right tabular-nums">{formatSRD(o.balance_due)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {pages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          {page > 1 && <Link href={qs(page - 1)} className="underline">Vorige</Link>}
          <span>Pagina {page} / {pages}</span>
          {page < pages && <Link href={qs(page + 1)} className="underline">Volgende</Link>}
        </div>
      )}
    </div>
  );
}
