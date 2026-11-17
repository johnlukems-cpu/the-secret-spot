"use client";
import { useActionState } from "react";
import { supportMessageAction } from "../actions";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

export function ContactForm() {
  const [state, action] = useActionState(supportMessageAction, null);
  if (state?.ok) return <Alert variant="success">Bedankt voor uw bericht! We nemen zo snel mogelijk contact met u op.</Alert>;
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4">
      <Field label="Naam" htmlFor="name" error={fe.name}><Input id="name" name="name" required /></Field>
      <Field label="WhatsApp of e-mail" htmlFor="contact" error={fe.contact}><Input id="contact" name="contact" required /></Field>
      <Field label="Bestelnummer (optioneel)" htmlFor="orderNumber"><Input id="orderNumber" name="orderNumber" placeholder="TSS-2026-000123" /></Field>
      <Field label="Bericht" htmlFor="message" error={fe.message}><Textarea id="message" name="message" required rows={5} /></Field>
      {state && !state.ok && !Object.keys(fe).length && <Alert variant="error">{state.error}</Alert>}
      <SubmitButton>Versturen</SubmitButton>
    </form>
  );
}
