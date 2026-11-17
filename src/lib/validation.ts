import { z } from "zod";

export const uuid = z.string().uuid();

export const cartLinesSchema = z
  .array(z.object({ variantId: uuid, quantity: z.number().int().min(1).max(99) }))
  .min(1, "Uw winkelwagen is leeg")
  .max(50);

export const whatsappSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ]{7,20}$/, "Vul een geldig WhatsApp-nummer in (bijv. +597 8123456)");

export const checkoutSchema = z.object({
  fullName: z.string().trim().min(2, "Vul uw volledige naam in").max(120),
  whatsapp: whatsappSchema,
  email: z.union([z.literal(""), z.string().trim().email("Ongeldig e-mailadres").max(200)]).optional(),
  zoneId: uuid.describe("district"),
  address: z.string().trim().min(5, "Vul uw bezorgadres in").max(300),
  instructions: z.string().trim().max(500).optional(),
  promoCode: z.string().trim().max(40).optional(),
  note: z.string().trim().max(500).optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "U moet akkoord gaan met de voorwaarden" }) }),
  lines: cartLinesSchema,
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const ALLOWED_PROOF_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;

export const paymentSubmissionSchema = z.object({
  orderNumber: z.string().trim().regex(/^TSS-\d{4}-\d{6}$/i, "Ongeldig bestelnummer"),
  token: z.string().trim().max(100).optional(),
  amount: z.coerce.number().positive("Vul het overgemaakte bedrag in").max(10_000_000),
  reference: z.string().trim().min(2, "Vul de betaalreferentie in").max(120),
  payerName: z.string().trim().max(120).optional(),
  transactionDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
});

/** Checks the file signature – the browser-supplied MIME type is not trusted. */
export function sniffMime(bytes: Uint8Array): (typeof ALLOWED_PROOF_TYPES)[number] | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  return null;
}

export const trackSchema = z.object({
  orderNumber: z.string().trim().regex(/^TSS-\d{4}-\d{6}$/i, "Ongeldig bestelnummer (bijv. TSS-2026-000123)"),
  whatsapp: whatsappSchema,
});

export const newsletterSchema = z.object({ email: z.string().trim().email("Ongeldig e-mailadres").max(200), consent: z.literal("on") });

export const supportSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contact: z.string().trim().min(5).max(200),
  orderNumber: z.string().trim().max(30).optional(),
  message: z.string().trim().min(5).max(2000),
});

export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
