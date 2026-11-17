"use client";
import { useActionState } from "react";
import { updatePasswordAction } from "@/app/(store)/auth-actions";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";

export default function NewPasswordPage() {
  const [state, action] = useActionState(updatePasswordAction, null);
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-4xl">Nieuw wachtwoord</h1>
      <form action={action} className="mt-8 space-y-4">
        <Field label="Nieuw wachtwoord" htmlFor="password" hint="Minimaal 10 tekens"><Input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" /></Field>
        {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
        <SubmitButton className="w-full">Opslaan</SubmitButton>
      </form>
    </div>
  );
}
