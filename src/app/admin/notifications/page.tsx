import { PageHeader } from "@/components/admin/page-header";
import { ActionForm } from "@/components/admin/action-form";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui/table";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { emailConfigured, whatsappConfigured } from "@/lib/notifications";
import { formatDate } from "@/lib/money";
import { dispatchNowAction, saveTemplateAction } from "./actions";

export const metadata = { title: "Notificaties" };

export default async function NotificationsPage() {
  await requirePermission("notifications.manage");
  const supabase = await createClient();
  const [{ data: templates }, { data: queue }] = await Promise.all([
    supabase.from("notification_templates").select("*").order("event").order("channel"),
    supabase.from("notifications").select("id, event, channel, recipient, status, error, created_at, sent_at").order("created_at", { ascending: false }).limit(100),
  ]);
  const email = emailConfigured(); const wa = whatsappConfigured();
  return (
    <div className="space-y-6">
      <PageHeader title="Notificaties" description="Sjablonen voor e-mail en WhatsApp. Variabelen: {order_number} {customer_name} {total} {deposit_required} {amount_paid} {balance_due} {currency} {payment_deadline} {payment_amount} {reason} {scheduled_date}"
        actions={<ActionForm action={dispatchNowAction}><SubmitButton size="sm" variant="outline">Wachtrij nu versturen</SubmitButton></ActionForm>} />
      <div className="grid gap-3 md:grid-cols-2">
        <Alert variant={email ? "success" : "warning"}>E-mail (Resend): {email ? "geconfigureerd" : "niet geconfigureerd – stel RESEND_API_KEY en EMAIL_FROM in. Berichten worden gemarkeerd als 'niet verstuurd'."}</Alert>
        <Alert variant={wa ? "success" : "warning"}>WhatsApp Cloud API: {wa ? "geconfigureerd (let op: buiten het 24-uursvenster zijn goedgekeurde templates vereist)" : "niet geconfigureerd – stel WHATSAPP_ACCESS_TOKEN en WHATSAPP_PHONE_NUMBER_ID in. Gebruik intussen de WhatsApp-knoppen (click-to-chat)."}</Alert>
      </div>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Sjablonen</h2>
        {(templates ?? []).map((t) => (
          <ActionForm key={t.id} action={saveTemplateAction} className="grid gap-2 rounded-lg border bg-white p-3 text-sm md:grid-cols-[180px_1fr_auto]">
            <input type="hidden" name="id" value={t.id} />
            <div><p className="font-medium">{t.event}</p><p className="text-xs text-taupe">{t.channel} · {t.locale}</p><label className="mt-1 flex items-center gap-1 text-xs"><input type="checkbox" name="is_active" defaultChecked={t.is_active} /> actief</label></div>
            <div className="space-y-1">
              {t.channel === "email" && <input name="subject" defaultValue={t.subject ?? ""} placeholder="Onderwerp" className="h-9 w-full rounded-md border px-2" />}
              <textarea name="body" defaultValue={t.body} rows={3} className="w-full rounded-md border p-2" />
            </div>
            <div><SubmitButton size="sm" variant="outline">Opslaan</SubmitButton></div>
          </ActionForm>
        ))}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Recente berichten</h2>
        <Table>
          <THead><TR><TH>Datum</TH><TH>Gebeurtenis</TH><TH>Kanaal</TH><TH>Ontvanger</TH><TH>Status</TH></TR></THead>
          <TBody>
            {(queue ?? []).length === 0 && <EmptyRow cols={5}>Geen berichten.</EmptyRow>}
            {(queue ?? []).map((n) => <TR key={n.id}><TD className="text-xs">{formatDate(n.created_at, true)}</TD><TD>{n.event}</TD><TD>{n.channel}</TD><TD className="text-xs">{n.recipient ?? "intern"}</TD><TD className="text-xs">{n.status === "skipped_not_configured" ? "niet verstuurd (niet geconfigureerd)" : n.status}{n.error && n.status === "failed" && <div className="text-red-700">{n.error}</div>}</TD></TR>)}
          </TBody>
        </Table>
      </section>
    </div>
  );
}
