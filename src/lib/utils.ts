import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Extracts a friendly message from a Postgres/Supabase error raised by our functions. */
export function dbErrorMessage(err: unknown): string {
  const msg = typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err);
  const map: Record<string, string> = {
    insufficient_stock: "Een of meer artikelen zijn niet meer (voldoende) op voorraad.",
    cart_invalid: "Uw winkelwagen is gewijzigd: controleer de artikelen en probeer opnieuw.",
    invalid_promo_code: "Deze kortingscode is ongeldig of verlopen.",
    promo_usage_limit_reached: "Deze kortingscode is niet meer geldig.",
    order_not_found: "Bestelling niet gevonden of gegevens komen niet overeen.",
    order_not_payable: "Voor deze bestelling kan geen betaling meer worden ingediend. Neem contact met ons op.",
    invalid_amount: "Ongeldig bedrag.",
    payment_reference_required: "Vul de betaalreferentie in.",
    too_many_pending_payments: "Er staan al meerdere betalingen ter controle. Wacht op verificatie.",
    "permission denied": "U heeft geen toestemming voor deze actie.",
    rejection_reason_required: "Geef een reden voor afwijzing op.",
    reason_required: "Een reden is verplicht.",
    cancellation_requires_staff: "Annuleren is alleen mogelijk via The Secret Girl. Neem contact met ons op.",
    "No exchange rate": "Er is geen wisselkoers ingesteld voor deze valuta. Voeg eerst een koers toe.",
    no_eligible_preorders: "Geen betaalde pre-orders zonder inkoopbatch voor deze leverancier.",
    "row-level security": "U heeft geen toestemming voor deze actie.",
  };
  for (const [key, nl] of Object.entries(map)) {
    if (msg.includes(key)) return nl;
  }
  return msg.length < 200 ? msg : "Er ging iets mis. Probeer het opnieuw.";
}
