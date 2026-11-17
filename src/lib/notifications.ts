import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";

export function emailConfigured() {
  return Boolean(serverEnv.resendApiKey && serverEnv.emailFrom);
}
export function whatsappConfigured() {
  return Boolean(serverEnv.whatsappToken && serverEnv.whatsappPhoneNumberId);
}

interface QueuedNotification { id: string; channel: "email" | "whatsapp" | "internal"; recipient: string | null; subject: string | null; body: string; attempts: number }

async function sendEmail(n: QueuedNotification): Promise<{ id?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${serverEnv.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: serverEnv.emailFrom, to: [n.recipient], subject: n.subject ?? "THE SECRET SPOT", text: n.body }),
  });
  if (!res.ok) throw new Error(`Email provider error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { id?: string };
}

/**
 * WhatsApp Cloud API (Meta). Free-form text is only delivered inside the 24-hour
 * customer-service window; outside it Meta requires pre-approved templates.
 * Delivery failures are recorded – never reported as success.
 */
async function sendWhatsApp(n: QueuedNotification): Promise<{ id?: string }> {
  const to = (n.recipient ?? "").replace(/\D/g, "");
  const normalized = to.length === 7 ? `597${to}` : to; // local Surinamese numbers
  const res = await fetch(
    `https://graph.facebook.com/${serverEnv.whatsappApiVersion}/${serverEnv.whatsappPhoneNumberId}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${serverEnv.whatsappToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: normalized, type: "text", text: { body: n.body.slice(0, 4000) } }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
  if (!res.ok) throw new Error(`WhatsApp API error ${res.status}: ${json.error?.message ?? "unknown"}`);
  return { id: json.messages?.[0]?.id };
}

/** Sends queued notifications. Channels without credentials are marked "skipped_not_configured". */
export async function dispatchPendingNotifications(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("notifications")
    .select("id, channel, recipient, subject, body, attempts")
    .eq("status", "queued")
    .lt("attempts", 5)
    .order("created_at")
    .limit(limit);
  const stats = { sent: 0, failed: 0, skipped: 0 };
  for (const n of (data ?? []) as QueuedNotification[]) {
    try {
      if (n.channel === "internal") {
        await admin.from("notifications").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", n.id);
        stats.sent++;
        continue;
      }
      const configured = n.channel === "email" ? emailConfigured() : whatsappConfigured();
      if (!configured) {
        await admin.from("notifications").update({ status: "skipped_not_configured", error: `${n.channel} provider credentials missing` }).eq("id", n.id);
        stats.skipped++;
        continue;
      }
      const result = n.channel === "email" ? await sendEmail(n) : await sendWhatsApp(n);
      await admin.from("notifications").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: result.id ?? null, attempts: n.attempts + 1 }).eq("id", n.id);
      stats.sent++;
    } catch (e) {
      const attempts = n.attempts + 1;
      await admin.from("notifications").update({ status: attempts >= 5 ? "failed" : "queued", attempts, error: String(e).slice(0, 500) }).eq("id", n.id);
      stats.failed++;
    }
  }
  return stats;
}
