import type { Metadata } from "next";
import { ContactForm } from "./contact-form";
import { getPublicSettings } from "@/lib/data/catalog";
import { whatsappLink } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage() {
  const settings = await getPublicSettings();
  const wa = whatsappLink(settings.store_whatsapp as string, "Hallo The Secret Spot!");
  const email = settings.store_email as string;
  return (
    <div className="container grid max-w-5xl gap-12 py-16 md:grid-cols-2">
      <div>
        <p className="eyebrow">Klantenservice</p>
        <h1 className="mt-2 text-4xl">Contact</h1>
        <p className="mt-4 text-sm text-taupe">Vragen over maten, beschikbaarheid, betalingen of uw levering? We helpen u graag.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {wa && <Button asChild variant="gold"><a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></Button>}
          {email && <Button asChild variant="outline"><a href={`mailto:${email}`}>{email}</a></Button>}
        </div>
      </div>
      <ContactForm />
    </div>
  );
}
