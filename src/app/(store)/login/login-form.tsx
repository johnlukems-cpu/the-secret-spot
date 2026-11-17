"use client";
import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "../auth-actions";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/account"} />
      <Field label="E-mailadres" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Wachtwoord" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
      <SubmitButton className="w-full">Inloggen</SubmitButton>
      <div className="flex justify-between text-sm">
        <Link href="/wachtwoord-vergeten" className="underline">Wachtwoord vergeten?</Link>
        <Link href="/registreren" className="underline">Account aanmaken</Link>
      </div>
    </form>
  );
}
