"use client";
import Link from "next/link";
import { useActionState } from "react";
import { registerAction } from "../auth-actions";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

export default function RegisterPage() {
  const [state, action] = useActionState(registerAction, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <div className="container max-w-md py-16">
      <h1 className="text-4xl">Account aanmaken</h1>
      {state?.ok ? (
        <Alert variant="success" className="mt-8">Controleer uw e-mail om uw account te bevestigen.</Alert>
      ) : (
        <form action={action} className="mt-8 space-y-4">
          <Field label="Volledige naam" htmlFor="fullName" error={fe.fullName}><Input id="fullName" name="fullName" autoComplete="name" required /></Field>
          <Field label="E-mailadres" htmlFor="email" error={fe.email}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
          <Field label="WhatsApp-nummer" htmlFor="whatsapp" error={fe.whatsapp}><Input id="whatsapp" name="whatsapp" type="tel" placeholder="+597 8123456" required /></Field>
          <Field label="Wachtwoord" htmlFor="password" error={fe.password} hint="Minimaal 10 tekens"><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
          {state && !state.ok && !Object.keys(fe).length && <Alert variant="error">{state.error}</Alert>}
          <SubmitButton className="w-full">Registreren</SubmitButton>
          <p className="text-sm">Al een account? <Link href="/login" className="underline">Inloggen</Link></p>
        </form>
      )}
    </div>
  );
}
