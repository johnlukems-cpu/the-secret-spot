import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { SubmitButton } from "@/components/ui/submit-button";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatSRD, type Currency } from "@/lib/money";
import { deleteExpenseAction, saveExpenseAction } from "./actions";

export const metadata = { title: "Uitgaven" };
const cats: Record<string, string> = { operating: "Bedrijfskosten", delivery: "Bezorging", marketing: "Marketing", rent: "Huur", salaries: "Salarissen", packaging: "Verpakking", bank_fees: "Bankkosten", software: "Software", import: "Import (niet aan zending gekoppeld)", other: "Overig" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requirePermission("expenses.manage");
  const { month } = await searchParams;
  const m = month ?? new Date().toISOString().slice(0, 7);
  const start = `${m}-01`;
  const end = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const supabase = await createClient();
  const { data } = await supabase.from("expenses").select("*").is("deleted_at", null).gte("expense_date", start).lte("expense_date", end).order("expense_date", { ascending: false });
  const total = (data ?? []).reduce((s, e) => s + Number(e.amount_srd), 0);
  return (
    <div className="space-y-6">
      <PageHeader title="Uitgaven" description="Bedrijfskosten die niet aan een zending gekoppeld zijn. Importkosten per zending legt u vast bij Zendingen." />
      <ActionForm action={saveExpenseAction} className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-4 text-sm" reset>
        <select name="category" className="h-9 rounded-md border px-2">{Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input name="description" required placeholder="Omschrijving" className="h-9 w-56 rounded-md border px-2" />
        <input name="vendor" placeholder="Leverancier" className="h-9 w-36 rounded-md border px-2" />
        <input name="amount" type="number" step="0.01" min="0.01" required placeholder="Bedrag" className="h-9 w-28 rounded-md border px-2" />
        <select name="currency" className="h-9 rounded-md border px-2">{["SRD", "USD", "EUR", "CNY"].map((c) => <option key={c}>{c}</option>)}</select>
        <input name="exchange_rate" type="number" step="0.00000001" defaultValue="1" required className="h-9 w-24 rounded-md border px-2" aria-label="Koers naar SRD" />
        <input name="expense_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="h-9 rounded-md border px-2" />
        <SubmitButton size="sm">Toevoegen</SubmitButton>
      </ActionForm>
      <form className="flex items-center gap-2 text-sm"><label>Maand <input type="month" name="month" defaultValue={m} className="h-9 rounded-md border px-2" /></label><button className="underline">Toon</button><span className="ml-auto font-semibold">Totaal: {formatSRD(total)}</span></form>
      <Table>
        <THead><TR><TH>Datum</TH><TH>Categorie</TH><TH>Omschrijving</TH><TH className="text-right">Bedrag</TH><TH className="text-right">SRD</TH><TH></TH></TR></THead>
        <TBody>
          {(data ?? []).length === 0 && <EmptyRow cols={6}>Geen uitgaven in deze maand.</EmptyRow>}
          {(data ?? []).map((e) => (
            <TR key={e.id}><TD>{formatDate(e.expense_date)}</TD><TD>{cats[e.category]}</TD><TD>{e.description}{e.vendor && <div className="text-xs text-taupe">{e.vendor}</div>}</TD>
              <TD className="text-right">{formatMoney(e.amount, e.currency as Currency)}</TD><TD className="text-right">{formatSRD(e.amount_srd)}</TD>
              <TD><ActionForm action={deleteExpenseAction} confirm="Uitgave verwijderen?"><input type="hidden" name="id" value={e.id} /><button className="text-xs underline">x</button></ActionForm></TD></TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
