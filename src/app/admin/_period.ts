export function resolvePeriod(sp: { from?: string; to?: string; period?: string }): { from: string; to: string; label: string } {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (sp.from && sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) return { from: sp.from, to: sp.to, label: `${sp.from} – ${sp.to}` };
  switch (sp.period) {
    case "day": return { from: iso(today), to: iso(today), label: "Vandaag" };
    case "week": { const d = new Date(today); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return { from: iso(d), to: iso(today), label: "Deze week" }; }
    case "year": return { from: `${today.getUTCFullYear()}-01-01`, to: iso(today), label: "Dit jaar" };
    default: return { from: `${iso(today).slice(0, 7)}-01`, to: iso(today), label: "Deze maand" };
  }
}

export function PeriodLinks({ base }: { base: string }) {
  return [["day", "Dag"], ["week", "Week"], ["month", "Maand"], ["year", "Jaar"]].map(([k, l]) => ({ href: `${base}?period=${k}`, label: l, key: k }));
}
