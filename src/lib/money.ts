export type Currency = "SRD" | "EUR" | "USD" | "CNY";

const formatters = new Map<string, Intl.NumberFormat>();

/** Formats a monetary amount, e.g. "SRD 1.450,00". Accepts numeric strings from Postgres. */
export function formatMoney(amount: number | string | null | undefined, currency: Currency = "SRD"): string {
  const n = typeof amount === "string" ? Number(amount) : amount ?? 0;
  const key = currency;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formatters.set(key, f);
  }
  return `${currency} ${f.format(Number.isFinite(n) ? n : 0)}`;
}

export const formatSRD = (amount: number | string | null | undefined) => formatMoney(amount, "SRD");

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "America/Paramaribo",
  }).format(d);
}
