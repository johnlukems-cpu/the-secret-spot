"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import type { ActionResult } from "../action-types";

export async function saveBankAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    id: z.string().uuid().optional().or(z.literal("")), bank_name: z.string().trim().min(2).max(80), account_holder: z.string().trim().min(2).max(120),
    account_number: z.string().trim().min(3).max(60), currency: z.enum(["SRD", "EUR", "USD", "CNY"]), instructions: z.string().max(1000).optional(),
    reference_format: z.string().trim().min(3).max(80).refine((s) => s.includes("{order_number}"), "Moet {order_number} bevatten"),
    show_at_checkout: z.string().optional(), is_active: z.string().optional(), sort_order: z.coerce.number().int().default(0),
  }), fd);
  if (!f.ok) return f;
  const { id, ...v } = f.data;
  const row = { ...v, instructions: v.instructions || null, show_at_checkout: !!v.show_at_checkout, is_active: !!v.is_active };
  return adminAction("settings.bank", async ({ supabase }) => {
    if (id) check(await supabase.from("bank_accounts").update(row).eq("id", id)); else check(await supabase.from("bank_accounts").insert(row));
  }, ["/admin/bank"]);
}
