import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveBankAction } from "./actions";

export const metadata = { title: "Bankgegevens" };
type B = { id?: string; bank_name?: string; account_holder?: string; account_number?: string; currency?: string; instructions?: string | null; reference_format?: string; show_at_checkout?: boolean; is_active?: boolean; sort_order?: number };

function BankForm({ b }: { b?: B }) {
  return (
    <ActionForm action={saveBankAction} className="grid gap-2 rounded-lg border bg-white p-4 text-sm md:grid-cols-3" reset={!b}>
      {b?.id && <input type="hidden" name="id" value={b.id} />}
      <label>Bank<input name="bank_name" required defaultValue={b?.bank_name} className="block h-9 w-full rounded-md border px-2" /></label>
      <label>Rekeninghouder<input name="account_holder" required defaultValue={b?.account_holder} className="block h-9 w-full rounded-md border px-2" /></label>
      <label>Rekeningnummer<input name="account_number" required defaultValue={b?.account_number} className="block h-9 w-full rounded-md border px-2" /></label>
      <label>Valuta<select name="currency" defaultValue={b?.currency ?? "SRD"} className="block h-9 w-full rounded-md border px-2">{["SRD", "USD", "EUR"].map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Omschrijving-formaat<input name="reference_format" required defaultValue={b?.reference_format ?? "{order_number}"} className="block h-9 w-full rounded-md border px-2" /></label>
      <label>Volgorde<input name="sort_order" type="number" defaultValue={b?.sort_order ?? 0} className="block h-9 w-full rounded-md border px-2" /></label>
      <label className="md:col-span-3">Betaalinstructies<textarea name="instructions" defaultValue={b?.instructions ?? ""} rows={2} className="block w-full rounded-md border p-2" /></label>
      <label className="flex items-center gap-2"><input type="checkbox" name="show_at_checkout" defaultChecked={b?.show_at_checkout} /> Tonen aan klanten bij betaling</label>
      <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={b?.is_active ?? true} /> Actief</label>
      <div><SubmitButton size="sm">{b ? "Opslaan" : "Rekening toevoegen"}</SubmitButton></div>
    </ActionForm>
  );
}

export default async function BankPage() {
  await requirePermission("settings.bank");
  const supabase = await createClient();
  const { data } = await supabase.from("bank_accounts").select("*").order("sort_order");
  return (
    <div className="space-y-4">
      <PageHeader title="Bankgegevens" description="Alleen rekeningen met 'Tonen aan klanten' verschijnen in de betaalinstructies. De tabel zelf is niet publiek leesbaar." />
      <Alert variant="warning">Sla hier nooit inloggegevens van internetbankieren, pincodes of kaartgegevens op.</Alert>
      {(data ?? []).map((b) => <BankForm key={b.id} b={b} />)}
      <BankForm />
    </div>
  );
}
