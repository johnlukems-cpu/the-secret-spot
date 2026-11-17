import type { Metadata } from "next";
import { TrackForm } from "./track-form";

export const metadata: Metadata = { title: "Bestelling volgen" };

export default function TrackPage() {
  return (
    <div className="container max-w-lg py-16">
      <p className="eyebrow">Klantenservice</p>
      <h1 className="mt-2 text-4xl">Bestelling volgen</h1>
      <p className="mt-3 text-sm text-taupe">Vul uw bestelnummer en het WhatsApp-nummer in dat u bij het bestellen heeft gebruikt.</p>
      <div className="mt-8"><TrackForm /></div>
    </div>
  );
}
