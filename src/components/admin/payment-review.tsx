import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { verifyPaymentAction } from "@/app/admin/orders/actions";
import { formatDate, formatSRD } from "@/lib/money";
import { paymentRecordLabel, statusVariant } from "@/lib/labels";

export interface PaymentRow {
  id: string; payment_number: string; order_id: string; kind: string; method: string; amount: string; reference: string | null;
  payer_name: string | null; transaction_date: string | null; status: string; source: string; created_at: string;
  verified_at: string | null; rejection_reason: string | null; proofs: { id: string; url: string | null; file_name: string | null; mime_type: string | null }[];
}

/** Payment card with proof links and approve/reject controls. Approval must follow a check of the real bank statement. */
export function PaymentReview({ p, canVerify, orderLabel }: { p: PaymentRow; canVerify: boolean; orderLabel?: React.ReactNode }) {
  const open = ["submitted", "under_verification"].includes(p.status);
  return (
    <div className="rounded-lg border bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{p.payment_number}</span> {orderLabel}
          <div className="text-xs text-taupe">{formatDate(p.created_at, true)} · {p.kind === "deposit" ? "Aanbetaling" : p.kind === "balance" ? "Restbetaling" : "Overig"} · {p.method} · bron: {p.source}</div>
        </div>
        <div className="flex items-center gap-2"><span className="font-semibold tabular-nums">{formatSRD(p.amount)}</span><Badge variant={statusVariant(p.status)}>{paymentRecordLabel[p.status]}</Badge></div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-4">
        <div><dt className="text-taupe">Referentie</dt><dd className="font-mono">{p.reference ?? "–"}</dd></div>
        <div><dt className="text-taupe">Naam betaler</dt><dd>{p.payer_name ?? "–"}</dd></div>
        <div><dt className="text-taupe">Datum overboeking</dt><dd>{p.transaction_date ? formatDate(p.transaction_date) : "–"}</dd></div>
        <div><dt className="text-taupe">Bewijs</dt><dd>{p.proofs.length ? p.proofs.map((pr) => pr.url ? <a key={pr.id} href={pr.url} target="_blank" rel="noopener noreferrer" className="mr-2 underline">{pr.mime_type === "application/pdf" ? "PDF" : "Afbeelding"}</a> : <span key={pr.id}>niet beschikbaar</span>) : "Geen"}</dd></div>
      </dl>
      {p.rejection_reason && <p className="mt-2 text-xs text-red-700">Reden afwijzing: {p.rejection_reason}</p>}
      {open && canVerify && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <p className="text-xs text-amber-800">Keur alleen goed nadat u de transactie op het bankafschrift heeft gezien. Pas het bedrag aan als er een ander bedrag is ontvangen.</p>
          <div className="flex flex-wrap items-end gap-2">
            {p.status === "submitted" && (
              <ActionForm action={verifyPaymentAction}>
                <input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="orderId" value={p.order_id} /><input type="hidden" name="decision" value="start" />
                <SubmitButton size="sm" variant="outline">In verificatie nemen</SubmitButton>
              </ActionForm>
            )}
            <ActionForm action={verifyPaymentAction} className="flex flex-wrap items-end gap-2" confirm="Heeft u de betaling op het bankafschrift gecontroleerd?">
              <input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="orderId" value={p.order_id} /><input type="hidden" name="decision" value="approve" />
              <label className="text-xs">Ontvangen bedrag<input name="amount" type="number" step="0.01" defaultValue={Number(p.amount).toFixed(2)} className="ml-1 h-9 w-28 rounded-md border px-2" /></label>
              <input name="note" placeholder="Notitie (bijv. afschrift d.d.)" className="h-9 w-48 rounded-md border px-2 text-xs" />
              <SubmitButton size="sm">Goedkeuren</SubmitButton>
            </ActionForm>
            <ActionForm action={verifyPaymentAction} className="flex items-end gap-2">
              <input type="hidden" name="paymentId" value={p.id} /><input type="hidden" name="orderId" value={p.order_id} /><input type="hidden" name="decision" value="reject" />
              <input name="note" required placeholder="Reden afwijzing" className="h-9 w-48 rounded-md border px-2 text-xs" />
              <SubmitButton size="sm" variant="destructive">Afwijzen</SubmitButton>
            </ActionForm>
          </div>
        </div>
      )}
    </div>
  );
}
