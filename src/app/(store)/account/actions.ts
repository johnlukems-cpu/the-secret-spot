"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, whatsappSchema } from "@/lib/validation";
import type { ActionResult } from "../actions";

/** Ensures the signed-in user has a customer record (created with service role, scoped to the session user). */
async function ensureCustomer(userId: string, fallback: { full_name: string; whatsapp: string; email: string | null }) {
  const admin = createAdminClient();
  const { data } = await admin.from("customers").select("id").eq("user_id", userId).maybeSingle();
  if (data) return data.id as string;
  const { data: created, error } = await admin.from("customers").insert({ user_id: userId, ...fallback }).select("id").single();
  if (error) throw new Error(error.message);
  return created.id as string;
}

export async function updateProfileAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const parsed = z.object({ fullName: z.string().trim().min(2).max(120), whatsapp: whatsappSchema }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, error: "Controleer de velden.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  await supabase.from("profiles").update({ full_name: parsed.data.fullName, phone: parsed.data.whatsapp }).eq("id", session.userId);
  const customerId = await ensureCustomer(session.userId, { full_name: parsed.data.fullName, whatsapp: parsed.data.whatsapp, email: session.email });
  const { error } = await supabase.from("customers").update({ full_name: parsed.data.fullName, whatsapp: parsed.data.whatsapp }).eq("id", customerId);
  if (error) return { ok: false, error: "Opslaan is niet gelukt." };
  revalidatePath("/account");
  return { ok: true, data: undefined };
}

export async function saveAddressAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const parsed = z.object({
    label: z.string().trim().max(60).optional(), zoneId: z.string().uuid("Kies een district"),
    address: z.string().trim().min(5, "Vul het adres in").max(300), instructions: z.string().trim().max(500).optional(),
    isDefault: z.string().optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, error: "Controleer de velden.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("full_name, phone").eq("id", session.userId).single();
  const customerId = await ensureCustomer(session.userId, { full_name: profile?.full_name || "Klant", whatsapp: profile?.phone || "0000000", email: session.email });
  if (parsed.data.isDefault) await supabase.from("customer_addresses").update({ is_default: false }).eq("customer_id", customerId);
  const { error } = await supabase.from("customer_addresses").insert({
    customer_id: customerId, label: parsed.data.label || null, zone_id: parsed.data.zoneId, address_line: parsed.data.address,
    instructions: parsed.data.instructions || null, is_default: Boolean(parsed.data.isDefault),
  });
  if (error) return { ok: false, error: "Opslaan is niet gelukt." };
  revalidatePath("/account/adressen");
  return { ok: true, data: undefined };
}

export async function deleteAddressAction(fd: FormData) {
  await requireUser();
  const supabase = await createClient();
  await supabase.from("customer_addresses").delete().eq("id", String(fd.get("id")));  // RLS: own rows only
  revalidatePath("/account/adressen");
}
