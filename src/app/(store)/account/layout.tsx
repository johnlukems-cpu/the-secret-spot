import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "../auth-actions";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  return (
    <div className="container py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Mijn account</p>
          <h1 className="text-4xl">Welkom terug</h1>
          <p className="text-sm text-taupe">{session.email}</p>
        </div>
        <div className="flex gap-3 text-sm">
          {session.isStaff && <Link href="/admin" className="underline">Naar admin</Link>}
          <form action={logoutAction}><button className="underline">Uitloggen</button></form>
        </div>
      </div>
      <nav className="mt-8 flex gap-6 border-b text-sm" aria-label="Account">
        <Link href="/account" className="pb-3">Bestellingen</Link>
        <Link href="/account/profiel" className="pb-3">Profiel</Link>
        <Link href="/account/adressen" className="pb-3">Adressen</Link>
        <Link href="/contact" className="pb-3">Klantenservice</Link>
      </nav>
      <div className="py-8">{children}</div>
    </div>
  );
}
