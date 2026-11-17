"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-3xl">Er ging iets mis</h1>
      <p className="mt-3 text-sm text-taupe">Probeer het opnieuw. Blijft het probleem bestaan, neem dan contact met ons op.</p>
      <button onClick={reset} className="mt-8 rounded-md bg-charcoal px-5 py-2.5 text-sm text-cream">Opnieuw proberen</button>
    </div>
  );
}
