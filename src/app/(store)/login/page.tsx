import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Inloggen", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="container max-w-md py-16">
      <h1 className="text-4xl">Inloggen</h1>
      <p className="mt-2 text-sm text-taupe">Bekijk uw bestellingen, betalingen en leveringen.</p>
      <div className="mt-8"><LoginForm next={next} /></div>
    </div>
  );
}
