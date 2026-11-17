"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trackOrderAction } from "../actions";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

export function TrackForm({ defaultOrderNumber = "" }: { defaultOrderNumber?: string }) {
  const [state, action] = useActionState(trackOrderAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      router.push(`/bestelling/${state.data.orderNumber}`);
      router.refresh();
    }
  }, [state, router]);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4">
      <Field label="Bestelnummer" htmlFor="orderNumber" error={fe.orderNumber}>
        <Input id="orderNumber" name="orderNumber" defaultValue={defaultOrderNumber} placeholder="TSS-2026-000123" required />
      </Field>
      <Field label="WhatsApp-nummer gebruikt bij de bestelling" htmlFor="whatsapp" error={fe.whatsapp}>
        <Input id="whatsapp" name="whatsapp" type="tel" placeholder="+597 8123456" required />
      </Field>
      {state && !state.ok && !Object.keys(fe).length && <Alert variant="error">{state.error}</Alert>}
      <SubmitButton className="w-full">Bestelling bekijken</SubmitButton>
    </form>
  );
}
