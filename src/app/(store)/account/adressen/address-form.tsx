"use client";
import { useActionState } from "react";
import { saveAddressAction } from "../actions";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

export function AddressForm({ zones }: { zones: { id: string; name: string }[] }) {
  const [state, action] = useActionState(saveAddressAction, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4">
      <Field label="Label (bijv. Thuis)" htmlFor="label"><Input id="label" name="label" /></Field>
      <Field label="District" htmlFor="zoneId" error={fe.zoneId}>
        <Select id="zoneId" name="zoneId" required defaultValue=""><option value="">Kies…</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select>
      </Field>
      <Field label="Adres" htmlFor="address" error={fe.address}><Input id="address" name="address" required /></Field>
      <Field label="Instructies" htmlFor="instructions"><Textarea id="instructions" name="instructions" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" /> Standaardadres</label>
      {state?.ok && <Alert variant="success">Adres opgeslagen.</Alert>}
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
      <SubmitButton>Opslaan</SubmitButton>
    </form>
  );
}
