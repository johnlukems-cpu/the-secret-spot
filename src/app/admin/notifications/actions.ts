"use server";
import { z } from "zod";
import { adminAction, check, parseForm } from "../_lib";
import { dispatchPendingNotifications } from "@/lib/notifications";
import type { ActionResult } from "../action-types";

export async function saveTemplateAction(_p: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const f = parseForm(z.object({ id: z.string().uuid(), subject: z.string().max(200).optional(), body: z.string().min(3).max(4000), is_active: z.string().optional() }), fd);
  if (!f.ok) return f;
  return adminAction("notifications.manage", async ({ supabase }) => {
    check(await supabase.from("notification_templates").update({ subject: f.data.subject || null, body: f.data.body, is_active: !!f.data.is_active }).eq("id", f.data.id));
  }, ["/admin/notifications"]);
}

export async function dispatchNowAction(): Promise<ActionResult<unknown>> {
  return adminAction("notifications.manage", async () => {
    const s = await dispatchPendingNotifications(100);
    return { ok: true, message: `Verstuurd: ${s.sent}, mislukt: ${s.failed}, niet geconfigureerd: ${s.skipped}` };
  }, ["/admin/notifications"]);
}
