import Link from "next/link";
import { Logo } from "./logo";
import { NewsletterForm } from "./newsletter-form";
import { whatsappLink } from "@/lib/whatsapp";

export function Footer({ settings }: { settings: Record<string, unknown> }) {
  const wa = whatsappLink(settings.store_whatsapp as string);
  const socials = [
    ["Instagram", settings.store_instagram], ["Facebook", settings.store_facebook], ["TikTok", settings.store_tiktok],
  ].filter(([, url]) => typeof url === "string" && url) as [string, string][];
  return (
    <footer className="bg-charcoal text-cream">
      <div className="container grid gap-10 py-14 md:grid-cols-4 [&>*]:min-w-0">
        <div className="space-y-4 md:col-span-1">
          <Logo tone="light" withTagline />
          <p className="text-sm text-cream/70">Mode voor het hele gezin. Direct leverbaar uit Suriname of als pre-order geïmporteerd. Levering in heel Suriname.</p>
        </div>
        <div>
          <h2 className="eyebrow mb-4 font-sans !text-gold">Shop</h2>
          <ul className="space-y-2 text-sm text-cream/80">
            <li><Link href="/collectie/dames">Dames</Link></li>
            <li><Link href="/collectie/heren">Heren</Link></li>
            <li><Link href="/collectie/kids">Kids</Link></li>
            <li><Link href="/collectie/schoenen">Schoenen</Link></li>
            <li><Link href="/collectie/accessoires">Accessoires</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="eyebrow mb-4 font-sans !text-gold">Klantenservice</h2>
          <ul className="space-y-2 text-sm text-cream/80">
            <li><Link href="/volg-bestelling">Bestelling volgen</Link></li>
            <li><Link href="/info/bestellen-en-betalen">Bestellen & betalen</Link></li>
            <li><Link href="/info/pre-order">Hoe werkt pre-order?</Link></li>
            <li><Link href="/info/voorwaarden">Voorwaarden & annulering</Link></li>
            <li><Link href="/info/privacy">Privacy</Link></li>
            <li><Link href="/contact">Contact</Link></li>
            {wa && <li><a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></li>}
          </ul>
        </div>
        <div>
          <h2 className="eyebrow mb-4 font-sans !text-gold">Nieuwsbrief</h2>
          <NewsletterForm />
          {socials.length > 0 && (
            <ul className="mt-6 flex gap-4 text-sm">
              {socials.map(([name, url]) => <li key={name}><a href={url} target="_blank" rel="noopener noreferrer" className="text-cream/80 hover:text-gold">{name}</a></li>)}
            </ul>
          )}
        </div>
      </div>
      <div className="border-t border-cream/10 py-5 text-center text-xs text-cream/50">© {new Date().getFullYear()} THE SECRET GIRL · YOUR STYLE. YOUR SECRET.</div>
    </footer>
  );
}
