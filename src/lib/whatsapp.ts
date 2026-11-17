/** Click-to-chat link (fallback when the WhatsApp Business API is not configured). */
export function whatsappLink(number: string | null | undefined, text?: string): string | null {
  const digits = (number ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  const intl = digits.length === 7 ? `597${digits}` : digits;
  return `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
