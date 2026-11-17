"use client";
import { useActionState } from "react";
import { updateProfileAction } from "../actions";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

export function ProfileForm({ fullName, whatsapp }: { fullName: string; whatsapp: string }) {
  const [state, action] = useActionState(updateProfileAction, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="max-w-md space-y-4">
      <Field label="Volledige naam" htmlFor="fullName" error={fe.fullName}><Input id="fullName" name="fullName" defaultValue={fullName} required /></Field>
      <Field label="WhatsApp-nummer" htmlFor="whatsapp" error={fe.whatsapp}><Input id="whatsapp" name="whatsapp" defaultValue={whatsapp} required /></Field>
      {state?.ok && <Alert variant="success">Opgeslagen.</Alert>}
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
      <SubmitButton>Opslaan</SubmitButton>
    </form>
  );
}
