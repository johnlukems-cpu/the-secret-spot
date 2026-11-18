"use client";
import { useActionState } from "react";
import { subscribeNewsletterAction } from "@/app/(store)/actions";
import { SubmitButton } from "@/components/ui/submit-button";

export function NewsletterForm() {
  const [state, action] = useActionState(subscribeNewsletterAction, null);
  if (state?.ok) return <p className="text-sm text-gold">Bedankt! U bent aangemeld voor onze nieuwsbrief.</p>;
  return (
    <form action={action} className="space-y-3">
      <div className="flex gap-2">
        <label htmlFor="nl-email" className="sr-only">E-mailadres</label>
        <input id="nl-email" name="email" type="email" required placeholder="Uw e-mailadres" className="h-11 min-w-0 flex-1 rounded-md border border-cream/30 bg-transparent px-3 text-base text-cream placeholder:text-cream/50 sm:text-sm" />
        <SubmitButton variant="gold">Aanmelden</SubmitButton>
      </div>
      <label className="flex items-start gap-2 text-xs text-cream/70">
        <input type="checkbox" name="consent" required className="mt-0.5" />
        Ik wil nieuws en aanbiedingen van The Secret Girl ontvangen en kan mij altijd afmelden.
      </label>
      {state && !state.ok && <p className="text-xs text-red-300">{state.error}</p>}
    </form>
  );
}
