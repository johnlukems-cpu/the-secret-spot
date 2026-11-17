import type { Metadata } from "next";
import { CheckoutForm } from "./checkout-form";
import { getActiveZones, getPublicSettings } from "@/lib/data/catalog";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Afrekenen", robots: { index: false } };

export default async function CheckoutPage() {
  const [zones, settings, session] = await Promise.all([getActiveZones(), getPublicSettings(), getSession()]);
  let prefill: { fullName?: string; whatsapp?: string; email?: string; zoneId?: string; address?: string; instructions?: string } = {};
  if (session) {
    const supabase = await createClient();
    const { data: c } = await supabase.from("customers").select("id, full_name, whatsapp, email").eq("user_id", session.userId).maybeSingle();
    const { data: profile } = await supabase.from("profiles").select("full_name, phone, email").eq("id", session.userId).maybeSingle();
    const { data: addr } = c ? await supabase.from("customer_addresses").select("zone_id, address_line, instructions").eq("customer_id", c.id).order("is_default", { ascending: false }).limit(1).maybeSingle() : { data: null };
    prefill = {
      fullName: c?.full_name ?? profile?.full_name ?? "", whatsapp: c?.whatsapp ?? profile?.phone ?? "", email: c?.email ?? profile?.email ?? session.email ?? "",
      zoneId: addr?.zone_id ?? undefined, address: addr?.address_line ?? "", instructions: addr?.instructions ?? "",
    };
  }
  return (
    <CheckoutForm
      zones={zones.map((z) => ({ id: z.id, name: z.name, estimated: z.estimated_days }))}
      prefill={prefill}
      policy={String(settings.cancellation_policy ?? "")}
      disclaimer={String(settings.payment_disclaimer ?? "Uw bestelling wordt pas bevestigd nadat uw betaling door The Secret Spot is geverifieerd.")}
      isLoggedIn={Boolean(session)}
    />
  );
}
