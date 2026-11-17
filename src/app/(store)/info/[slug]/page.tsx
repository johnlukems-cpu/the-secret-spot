import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicSettings, getSiteContent } from "@/lib/data/catalog";

const builtIn: Record<string, { title: string; body: (s: Record<string, unknown>) => string }> = {
  "bestellen-en-betalen": {
    title: "Bestellen & betalen",
    body: (s) => `1. Kies uw artikelen en plaats uw bestelling.\n2. U ziet direct de vereiste aanbetaling (ready-to-order: ${s.deposit_ready_pct ?? "–"}%, pre-order: ${s.deposit_preorder_pct ?? "–"}% tenzij anders vermeld) en de bankgegevens.\n3. Maak de aanbetaling over binnen ${s.payment_deadline_hours ?? "–"} uur en geef uw betaalreferentie door, eventueel met betaalbewijs.\n4. Wij controleren de betaling op onze bankrekening. ${s.payment_disclaimer ?? ""}\n5. Het resterende bedrag betaalt u bij levering.\n\nNiet tijdig betaalde bestellingen vervallen en gereserveerde artikelen worden weer vrijgegeven.`,
  },
  "pre-order": {
    title: "Hoe werkt pre-order?",
    body: () => "Pre-order artikelen zijn niet op voorraad in Suriname. Na verificatie van uw aanbetaling nemen wij uw bestelling op in onze wekelijkse inkoopronde bij onze leveranciers. Daarna wordt de zending naar Suriname verscheept, ingeklaard en gecontroleerd.\n\nAlle leverdata zijn schattingen. Vertragingen bij leverancier, transport of douane zijn mogelijk; wij houden u via WhatsApp of e-mail op de hoogte.",
  },
  voorwaarden: { title: "Voorwaarden & annulering", body: (s) => String(s.cancellation_policy ?? "") },
  privacy: {
    title: "Privacy",
    body: () => "Wij gebruiken uw gegevens (naam, WhatsApp-nummer, e-mail en bezorgadres) uitsluitend om uw bestelling te verwerken, te leveren en u op de hoogte te houden. Betaalbewijzen worden beveiligd opgeslagen en zijn alleen toegankelijk voor bevoegde medewerkers. Wij slaan geen bank-inloggegevens of kaartgegevens op. Analytische cookies worden alleen geplaatst met uw toestemming.\n\n(De eigenaar dient deze tekst te laten controleren en aan te vullen.)",
  },
};

async function resolve(slug: string, settings: Record<string, unknown>) {
  const pages = (await getSiteContent()).filter((b) => b.block_type === "page");
  const custom = pages.find((p) => p.key === slug);
  if (custom) return { title: custom.title ?? slug, body: custom.body ?? "" };
  const b = builtIn[slug];
  return b ? { title: b.title, body: b.body(settings) } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await resolve(slug, await getPublicSettings());
  return page ? { title: page.title, alternates: { canonical: `/info/${slug}` } } : {};
}

export default async function InfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await resolve(slug, await getPublicSettings());
  if (!page) notFound();
  return (
    <article className="container max-w-2xl py-16">
      <h1 className="text-4xl">{page.title}</h1>
      <div className="mt-6 whitespace-pre-line text-sm leading-relaxed">{page.body}</div>
    </article>
  );
}
