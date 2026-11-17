"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { useCart } from "@/components/store/cart-provider";
import { OrderSummary } from "@/components/store/order-summary";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { checkoutSchema } from "@/lib/validation";
import { formatSRD } from "@/lib/money";
import { placeOrderAction } from "../actions";
import { lineIssue, useServerPricing } from "../winkelwagen/cart-view";

const formSchema = checkoutSchema.omit({ lines: true });
type FormValues = z.input<typeof formSchema>;

export function CheckoutForm({ zones, prefill, policy, disclaimer, isLoggedIn }: {
  zones: { id: string; name: string; estimated: string | null }[];
  prefill: Partial<Record<"fullName" | "whatsapp" | "email" | "zoneId" | "address" | "instructions", string>>;
  policy: string; disclaimer: string; isLoggedIn: boolean;
}) {
  const { items, ready, clear } = useCart();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState("");
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { fullName: "", whatsapp: "", email: "", address: "", instructions: "", note: "", promoCode: "", ...prefill, zoneId: prefill.zoneId ?? "", acceptTerms: false as unknown as true },
  });
  const zoneId = form.watch("zoneId");
  const { priced, error, loading } = useServerPricing(items, ready, zoneId || undefined, promo || undefined);
  const errs = form.formState.errors;

  if (ready && !items.length) {
    return (
      <div className="container py-24 text-center">
        <h1 className="text-4xl">Uw winkelwagen is leeg</h1>
        <Button asChild className="mt-8"><Link href="/collectie">Naar de collectie</Link></Button>
      </div>
    );
  }

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    start(async () => {
      const res = await placeOrderAction({ ...values, promoCode: promo, lines: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })) } as never);
      if (!res.ok) {
        setServerError(res.error);
        if (res.fieldErrors) Object.entries(res.fieldErrors).forEach(([k, m]) => form.setError(k as keyof FormValues, { message: m }));
        return;
      }
      clear();
      router.push(`/bestelling/${res.data.orderNumber}?t=${res.data.token}&nieuw=1`);
    });
  });

  return (
    <div className="container py-10">
      <h1 className="text-4xl">Afrekenen</h1>
      {!isLoggedIn && <p className="mt-2 text-sm text-taupe">U bestelt als gast. <Link href="/login?next=/afrekenen" className="underline">Inloggen</Link> om uw bestellingen in uw account te bewaren.</p>}
      <form onSubmit={onSubmit} noValidate className="mt-8 grid gap-10 lg:grid-cols-[1fr_400px]">
        <div className="space-y-8">
          <fieldset className="space-y-4">
            <legend className="eyebrow mb-2">Uw gegevens</legend>
            <Field label="Volledige naam *" htmlFor="fullName" error={errs.fullName?.message}>
              <Input id="fullName" autoComplete="name" {...form.register("fullName")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="WhatsApp-nummer *" htmlFor="whatsapp" error={errs.whatsapp?.message} hint="Voor updates over uw bestelling">
                <Input id="whatsapp" type="tel" inputMode="tel" autoComplete="tel" placeholder="+597 8123456" {...form.register("whatsapp")} />
              </Field>
              <Field label="E-mailadres (optioneel)" htmlFor="email" error={errs.email?.message}>
                <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
              </Field>
            </div>
          </fieldset>
          <fieldset className="space-y-4">
            <legend className="eyebrow mb-2">Bezorging</legend>
            <Field label="District *" htmlFor="zoneId" error={errs.zoneId ? "Kies uw district" : undefined}>
              <Select id="zoneId" {...form.register("zoneId")}>
                <option value="">Kies een district…</option>
                {zones.map((z) => <option key={z.id} value={z.id}>{z.name}{z.estimated ? ` (${z.estimated})` : ""}</option>)}
              </Select>
            </Field>
            <Field label="Bezorgadres *" htmlFor="address" error={errs.address?.message}>
              <Input id="address" autoComplete="street-address" placeholder="Straat, huisnummer, wijk" {...form.register("address")} />
            </Field>
            <Field label="Bezorginstructies" htmlFor="instructions" error={errs.instructions?.message}>
              <Textarea id="instructions" placeholder="Bijv. bel bij aankomst, kleur van het huis…" {...form.register("instructions")} />
            </Field>
            <Field label="Opmerking bij bestelling" htmlFor="note">
              <Textarea id="note" {...form.register("note")} />
            </Field>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="eyebrow mb-2">Betaling</legend>
            <Alert>
              U betaalt de aanbetaling via bankoverschrijving. Na het plaatsen van de bestelling ziet u de bankgegevens en kunt u uw betaalreferentie en betaalbewijs uploaden.
              <strong className="mt-2 block">{disclaimer}</strong>
            </Alert>
            {policy && <details className="text-sm"><summary className="cursor-pointer underline">Annulerings- en terugbetalingsvoorwaarden</summary><p className="mt-2 whitespace-pre-line text-taupe">{policy}</p></details>}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" {...form.register("acceptTerms")} />
              <span>Ik ga akkoord met de <Link href="/info/voorwaarden" target="_blank" className="underline">voorwaarden</Link> en begrijp dat leverdata van pre-orders schattingen zijn.</span>
            </label>
            {errs.acceptTerms && <p className="text-xs text-destructive">{errs.acceptTerms.message}</p>}
          </fieldset>
        </div>

        <aside className="h-fit space-y-5 rounded-lg border p-6 lg:sticky lg:top-28">
          <h2 className="font-sans text-sm font-semibold uppercase tracking-wide">Uw bestelling</h2>
          <ul className="space-y-2 text-sm">
            {items.map((i) => (
              <li key={i.variantId} className="flex justify-between gap-3">
                <span>
                  {i.quantity}× {i.title}
                  <span className="block text-xs text-taupe">{[i.color, i.size].filter(Boolean).join(" · ")} · {i.salesType === "preorder" ? "Pre-order" : "Op voorraad"}</span>
                  {lineIssue(priced, i.variantId) && <span className="block text-xs text-red-700">{lineIssue(priced, i.variantId)}</span>}
                </span>
                <span className="shrink-0">{priced ? formatSRD(priced.lines.find((l) => l.variant_id === i.variantId)?.line_total ?? 0) : "…"}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input aria-label="Kortingscode" placeholder="Kortingscode" value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} />
            <Button type="button" variant="outline" onClick={() => setPromo(promoInput.trim())}>Toepassen</Button>
          </div>
          {priced?.promo_message && <p className="text-xs text-red-700">{priced.promo_message === "promo_min_order_not_met" ? "Minimaal bestelbedrag voor deze code niet bereikt." : "Ongeldige of verlopen kortingscode."}</p>}
          {error && <Alert variant="error">{error}</Alert>}
          {priced ? <OrderSummary cart={priced} /> : <div className="flex justify-center py-4"><Loader2 className="animate-spin" /></div>}
          {serverError && <Alert variant="error">{serverError}</Alert>}
          <Button type="submit" size="lg" className="w-full" disabled={pending || loading || !priced || priced.errors.length > 0 || Boolean(priced?.promo_message && promo)}>
            {pending && <Loader2 className="animate-spin" />} Bestelling plaatsen
          </Button>
          <p className="text-center text-xs text-taupe">Alle bedragen worden door ons systeem berekend en gecontroleerd.</p>
        </aside>
      </form>
    </div>
  );
}
