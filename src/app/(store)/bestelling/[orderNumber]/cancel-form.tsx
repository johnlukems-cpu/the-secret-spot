"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cancelOrderAction } from "../../actions";
import { SubmitButton } from "@/components/ui/submit-button";

export function CancelForm({ orderNumber }: { orderNumber: string }) {
  const [state, action] = useActionState(cancelOrderAction, null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-taupe underline">Bestelling annuleren</summary>
      <form action={action} className="mt-3 space-y-2" onSubmit={(e) => { if (!confirm("Weet u zeker dat u deze bestelling wilt annuleren?")) e.preventDefault(); }}>
        <input type="hidden" name="orderNumber" value={orderNumber} />
        <input name="reason" placeholder="Reden (optioneel)" className="h-10 w-full rounded-md border px-3" maxLength={300} />
        {state && !state.ok && <p className="text-xs text-red-700">{state.error}</p>}
        <SubmitButton variant="outline" size="sm">Annuleren bevestigen</SubmitButton>
      </form>
    </details>
  );
}
