import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-taupe">404</p>
      <h1 className="mt-2 text-4xl">Pagina niet gevonden</h1>
      <p className="mt-3 text-sm text-taupe">Deze pagina bestaat niet (meer).</p>
      <Link href="/" className="mt-8 inline-block underline">Terug naar de winkel</Link>
    </div>
  );
}
