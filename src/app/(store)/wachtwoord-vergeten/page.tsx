"use client";
import { useActionState } from "react";
import { forgotPasswordAction } from "../auth-actions";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

export default function ForgotPage() {
  const [state, action] = useActionState(forgotPasswordAction, null);
  return (
    <div className="container max-w-md py-16">
      <h1 className="text-4xl">Wachtwoord vergeten</h1>
      {state?.ok ? <Alert variant="success" className="mt-8">Als dit e-mailadres bij ons bekend is, ontvangt u een link om uw wachtwoord te herstellen.</Alert> : (
        <form action={action} className="mt-8 space-y-4">
          <Field label="E-mailadres" htmlFor="email"><Input id="email" name="email" type="email" required /></Field>
          {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
          <SubmitButton className="w-full">Herstellink versturen</SubmitButton>
        </form>
      )}
    </div>
  );
}
