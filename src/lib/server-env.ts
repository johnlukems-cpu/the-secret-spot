import "server-only";

/** Server-only secrets. Never import this file from client components. */
export const serverEnv = {
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",
  whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION ?? "v21.0",
  ipHashSalt: process.env.IP_HASH_SALT ?? "tss",
};
