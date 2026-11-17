"use client";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { submitPaymentAction } from "../../actions";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

export function PaymentForm({ orderNumber, token, suggestedAmount, referenceHint }: { orderNumber: string; token?: string; suggestedAmount: number; referenceHint: string }) {
  const [state, action] = useActionState(submitPaymentAction, null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4" encType="multipart/form-data">
      <input type="hidden" name="orderNumber" value={orderNumber} />
      {token && <input type="hidden" name="token" value={token} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Overgemaakt bedrag (SRD) *" htmlFor="amount" error={fe.amount}>
          <Input id="amount" name="amount" type="number" step="0.01" min="0.01" inputMode="decimal" defaultValue={suggestedAmount.toFixed(2)} required />
        </Field>
        <Field label="Betaalreferentie / transactienummer *" htmlFor="reference" error={fe.reference} hint={`Bijv. ${referenceHint}`}>
          <Input id="reference" name="reference" required maxLength={120} />
        </Field>
        <Field label="Naam rekeninghouder" htmlFor="payerName">
          <Input id="payerName" name="payerName" maxLength={120} />
        </Field>
        <Field label="Datum overboeking" htmlFor="transactionDate">
          <Input id="transactionDate" name="transactionDate" type="date" />
        </Field>
      </div>
      <Field label="Betaalbewijs (optioneel, JPG/PNG/WEBP/PDF, max. 10 MB)" htmlFor="proof">
        <Input id="proof" name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="py-2" />
      </Field>
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
      {state?.ok && <Alert variant="success">Bedankt! Uw betaling ({state.data.paymentNumber}) is ontvangen en wordt gecontroleerd. U ontvangt bericht zodra deze is geverifieerd.</Alert>}
      <SubmitButton pendingText="Versturen…">Betaling doorgeven</SubmitButton>
    </form>
  );
}
