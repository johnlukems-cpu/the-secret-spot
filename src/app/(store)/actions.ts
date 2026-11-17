"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { dispatchPendingNotifications } from "@/lib/notifications";
import { dbErrorMessage } from "@/lib/utils";
import {
  ALLOWED_PROOF_TYPES, MAX_PROOF_BYTES, cartLinesSchema, checkoutSchema, fieldErrors, newsletterSchema,
  paymentSubmissionSchema, sniffMime, supportSchema, trackSchema, type CheckoutInput,
} from "@/lib/validation";
import type { CartLine, PricedCart } from "@/lib/types";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Authoritative cart pricing from the database (prices never come from the browser). */
export async function priceCartAction(lines: CartLine[], zoneId?: string | null, promoCode?: string | null): Promise<ActionResult<PricedCart>> {
  const parsed = cartLinesSchema.safeParse(lines);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ongeldige winkelwagen" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("price_cart", {
    _input: {
      items: parsed.data.map((l) => ({ variant_id: l.variantId, quantity: l.quantity })),
      zone_id: zoneId || null,
      promo_code: promoCode || null,
    },
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, data: data as PricedCart };
}

export async function placeOrderAction(input: CheckoutInput): Promise<ActionResult<{ orderNumber: string; token: string }>> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrors(parsed.error) };
  if (!(await rateLimit("checkout", 8, 600))) {
    return { ok: false, error: "Te veel bestelpogingen. Probeer het over enkele minuten opnieuw." };
  }
  const session = await getSession();
  const v = parsed.data;
  const { data, error } = await createAdminClient().rpc("create_order", {
    _input: {
      user_id: session?.userId ?? null,
      customer: { full_name: v.fullName, whatsapp: v.whatsapp, email: v.email || null },
      zone_id: v.zoneId,
      address: v.address,
      instructions: v.instructions || null,
      promo_code: v.promoCode || null,
      note: v.note || null,
      items: v.lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity })),
    },
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  const res = data as { order_number: string; access_token: string };
  // Remember the guest access token on this device so the customer can return to the order.
  (await cookies()).set(`tss_o_${res.order_number}`, res.access_token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 90, path: "/",
  });
  await dispatchPendingNotifications(20).catch((e) => console.error("notification dispatch failed", e));
  return { ok: true, data: { orderNumber: res.order_number, token: res.access_token } };
}

export async function submitPaymentAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ paymentNumber: string }>> {
  const parsed = paymentSubmissionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Controleer de gemarkeerde velden.", fieldErrors: fieldErrors(parsed.error) };
  if (!(await rateLimit("payment_submit", 10, 3600))) return { ok: false, error: "Te veel pogingen. Probeer het later opnieuw." };

  const v = parsed.data;
  const orderNumber = v.orderNumber.toUpperCase();
  const token = v.token || (await cookies()).get(`tss_o_${orderNumber}`)?.value || null;
  const admin = createAdminClient();

  // Verify access before accepting any file (owner session or guest token).
  const userClient = await createClient();
  const { error: accessError } = await userClient.rpc("track_order", { _order_number: orderNumber, _token: token });
  if (accessError) return { ok: false, error: dbErrorMessage(accessError) };
  const { data: orderRow } = await admin.from("orders").select("id").eq("order_number", orderNumber).single();
  if (!orderRow) return { ok: false, error: "Bestelling niet gevonden." };

  let proof: Record<string, unknown> | null = null;
  const file = formData.get("proof");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PROOF_BYTES) return { ok: false, error: "Bestand is te groot (max. 10 MB)." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime || !(ALLOWED_PROOF_TYPES as readonly string[]).includes(mime)) {
      return { ok: false, error: "Alleen JPG, PNG, WEBP of PDF bestanden zijn toegestaan." };
    }
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[mime];
    const path = `orders/${orderRow.id}/${randomUUID()}.${ext}`;
    const { error: upErr } = await admin.storage.from("payment-proofs").upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) return { ok: false, error: "Upload van het betaalbewijs is mislukt. Probeer het opnieuw of verstuur alleen de referentie." };
    proof = { storage_path: path, file_name: file.name.slice(0, 200), mime_type: mime, size_bytes: file.size };
  }

  // Access was verified above (session owner or guest token); the DB function re-validates amounts and state.
  const { data, error } = await admin.rpc("submit_payment", {
    _order_number: orderNumber,
    _token: token,
    _amount: v.amount,
    _reference: v.reference,
    _payer_name: v.payerName || null,
    _transaction_date: v.transactionDate || null,
    _proof: proof,
  });
  if (error) {
    if (proof) await admin.storage.from("payment-proofs").remove([proof.storage_path as string]);
    return { ok: false, error: dbErrorMessage(error) };
  }
  await dispatchPendingNotifications(10).catch(() => {});
  return { ok: true, data: { paymentNumber: (data as { payment_number: string }).payment_number } };
}

export async function trackOrderAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ orderNumber: string }>> {
  const parsed = trackSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Controleer uw gegevens.", fieldErrors: fieldErrors(parsed.error) };
  if (!(await rateLimit("track", 20, 600))) return { ok: false, error: "Te veel pogingen. Probeer het later opnieuw." };
  const supabase = await createClient();
  const orderNumber = parsed.data.orderNumber.toUpperCase();
  const { error } = await supabase.rpc("track_order", { _order_number: orderNumber, _token: null, _whatsapp: parsed.data.whatsapp });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  // Remember the verified phone digits for one hour so the order page can re-check access server-side.
  (await cookies()).set(`tss_w_${orderNumber}`, parsed.data.whatsapp.replace(/\D/g, "").slice(-7), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60, path: "/",
  });
  return { ok: true, data: { orderNumber } };
}

export async function cancelOrderAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const orderNumber = String(formData.get("orderNumber") ?? "").toUpperCase();
  const reason = String(formData.get("reason") ?? "").trim() || "Geannuleerd door klant";
  const token = (await cookies()).get(`tss_o_${orderNumber}`)?.value ?? null;
  const admin = createAdminClient();
  const { data: o } = await admin.from("orders").select("id, user_id").eq("order_number", orderNumber).maybeSingle();
  if (!o) return { ok: false, error: "Bestelling niet gevonden." };
  const session = await getSession();
  // Use the customer's own identity: the DB checks ownership/token and the cancellation rules.
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_order", { _order_id: o.id, _reason: reason.slice(0, 300), _token: session && o.user_id === session.userId ? null : token });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, data: undefined };
}

export async function subscribeNewsletterAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = newsletterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Vul een geldig e-mailadres in en geef toestemming." };
  if (!(await rateLimit("newsletter", 5, 3600))) return { ok: false, error: "Te veel pogingen." };
  const { error } = await createAdminClient().from("newsletter_subscribers")
    .upsert({ email: parsed.data.email.toLowerCase(), source: "website", unsubscribed_at: null }, { onConflict: "email" });
  if (error) return { ok: false, error: "Aanmelden is niet gelukt." };
  return { ok: true, data: undefined };
}

export async function supportMessageAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = supportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Vul alle velden in.", fieldErrors: fieldErrors(parsed.error) };
  if (!(await rateLimit("support", 5, 3600))) return { ok: false, error: "Te veel berichten. Probeer het later opnieuw." };
  const session = await getSession();
  const admin = createAdminClient();
  const customer = session ? (await admin.from("customers").select("id").eq("user_id", session.userId).maybeSingle()).data : null;
  const { error } = await admin.from("support_messages").insert({
    name: parsed.data.name, contact: parsed.data.contact, order_number: parsed.data.orderNumber || null,
    message: parsed.data.message, user_id: session?.userId ?? null, customer_id: customer?.id ?? null,
  });
  if (error) return { ok: false, error: "Versturen is niet gelukt." };
  return { ok: true, data: undefined };
}
