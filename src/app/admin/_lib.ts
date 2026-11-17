import "server-only";
import { revalidatePath } from "next/cache";
import type { ZodSchema } from "zod";
import { can, getSession, type Permission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/utils";
import { fieldErrors } from "@/lib/validation";
import type { ActionResult } from "./action-types";

/**
 * Wraps an admin server action: checks the session permission (UX layer), then
 * runs the handler with a user-scoped Supabase client so RLS and the database
 * permission checks are enforced again.
 */
export async function adminAction<T>(
  perm: Permission,
  fn: (ctx: { supabase: Awaited<ReturnType<typeof createClient>>; userId: string }) => Promise<T | ActionResult<T>>,
  revalidate?: string | string[],
): Promise<ActionResult<T>> {
  const session = await getSession();
  if (!session || !can(session, perm)) return { ok: false, error: "U heeft geen toestemming voor deze actie." };
  try {
    const supabase = await createClient();
    const out = await fn({ supabase, userId: session.userId });
    for (const p of [revalidate ?? []].flat()) revalidatePath(p, "page");
    if (out && typeof out === "object" && "ok" in (out as object)) return out as ActionResult<T>;
    return { ok: true, data: out as T };
  } catch (e) {
    return { ok: false, error: dbErrorMessage(e) };
  }
}

export function parseForm<T>(schema: ZodSchema<T>, fd: FormData): { ok: true; data: T } | { ok: false; error: string; fieldErrors: Record<string, string> } {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (raw[k] !== undefined) raw[k] = [raw[k], v].flat();
    else raw[k] = v;
  }
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: "Controleer de invoer.", fieldErrors: fieldErrors(r.error) };
}

/** Throws a database error so adminAction converts it into a friendly message. */
export function check<T extends { error: unknown }>(res: T): T {
  if (res.error) throw res.error;
  return res;
}

export const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
