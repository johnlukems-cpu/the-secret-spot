"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import type { ActionResult } from "../action-types";

export async function saveExpenseAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({
    category: z.enum(["operating", "delivery", "marketing", "rent", "salaries", "packaging", "bank_fees", "software", "import", "other"]),
    description: z.string().trim().min(2).max(300), amount: z.coerce.number().positive(), currency: z.enum(["SRD", "EUR", "USD", "CNY"]),
    exchange_rate: z.coerce.number().positive(), expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), vendor: z.string().max(120).optional(),
  }), fd);
  if (!f.ok) return f;
  if (f.data.currency === "SRD" && f.data.exchange_rate !== 1) return { ok: false, error: "Voor SRD is de koers 1." };
  return adminAction("expenses.manage", async ({ supabase, userId }) => {
    check(await supabase.from("expenses").insert({ ...f.data, vendor: f.data.vendor || null, created_by: userId }));
  }, ["/admin/expenses", "/admin/finance"]);
}

export async function deleteExpenseAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return adminAction("expenses.manage", async ({ supabase }) => {
    check(await supabase.from("expenses").update({ deleted_at: new Date().toISOString() }).eq("id", String(fd.get("id"))));
  }, ["/admin/expenses", "/admin/finance"]);
}
