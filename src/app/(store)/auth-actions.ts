"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { fieldErrors, whatsappSchema } from "@/lib/validation";
import type { ActionResult } from "./actions";

const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/account");

export async function loginAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  if (!(await rateLimit("login", 10, 600))) return { ok: false, error: "Te veel inlogpogingen. Probeer het over 10 minuten opnieuw." };
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, error: "Vul uw e-mailadres en wachtwoord in." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: "Onjuist e-mailadres of wachtwoord." };
  redirect(safeNext(fd.get("next")));
}

export async function registerAction(_p: unknown, fd: FormData): Promise<ActionResult<{ confirm: boolean }>> {
  if (!(await rateLimit("register", 5, 3600))) return { ok: false, error: "Te veel registraties vanaf dit apparaat." };
  const parsed = z.object({
    fullName: z.string().trim().min(2, "Vul uw naam in").max(120),
    email: z.string().trim().email("Ongeldig e-mailadres"),
    whatsapp: whatsappSchema,
    password: z.string().min(10, "Minimaal 10 tekens").max(72),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, error: "Controleer de velden.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email, password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName, phone: parsed.data.whatsapp }, emailRedirectTo: `${publicEnv.siteUrl}/auth/callback?next=/account` },
  });
  if (error) return { ok: false, error: error.message.includes("registered") ? "Dit e-mailadres is al geregistreerd." : "Registreren is niet gelukt." };
  if (data.session) redirect("/account");
  return { ok: true, data: { confirm: true } };
}

export async function forgotPasswordAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  if (!(await rateLimit("forgot", 5, 3600))) return { ok: false, error: "Te veel pogingen." };
  const email = String(fd.get("email") ?? "").trim();
  if (!z.string().email().safeParse(email).success) return { ok: false, error: "Ongeldig e-mailadres." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${publicEnv.siteUrl}/auth/callback?next=/auth/nieuw-wachtwoord` });
  return { ok: true, data: undefined }; // same response whether or not the account exists
}

export async function updatePasswordAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const pw = String(fd.get("password") ?? "");
  if (pw.length < 10) return { ok: false, error: "Minimaal 10 tekens." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { ok: false, error: "Wachtwoord wijzigen is niet gelukt. Vraag een nieuwe link aan." };
  redirect("/account");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
