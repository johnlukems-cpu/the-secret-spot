"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, Search, ShoppingBag, User, X } from "lucide-react";
import { Logo } from "./logo";
import { useCart } from "./cart-provider";
import type { Category } from "@/lib/types";

export function Header({ categories, announcement, isLoggedIn }: { categories: Category[]; announcement?: { title: string; link: string | null } | null; isLoggedIn: boolean }) {
  const { count, ready } = useCart();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => { setOpen(false); setSearchOpen(false); }, [pathname]);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      {announcement && (
        <div className="bg-charcoal px-4 py-2 text-center text-[11px] uppercase tracking-[0.2em] text-cream">
          {announcement.link ? <Link href={announcement.link} className="hover:text-gold">{announcement.title}</Link> : announcement.title}
        </div>
      )}
      <div className="container flex h-16 items-center justify-between gap-4 border-b md:h-20">
        <div className="flex items-center gap-1 lg:hidden">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger className="-ml-2 p-2" aria-label="Menu openen"><Menu className="h-5 w-5" /></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-charcoal/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[85%] max-w-sm overflow-y-auto bg-white p-6 shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-left">
                <div className="mb-8 flex items-center justify-between">
                  <Dialog.Title className="sr-only">Menu</Dialog.Title>
                  <Logo />
                  <Dialog.Close aria-label="Sluiten" className="p-2"><X className="h-5 w-5" /></Dialog.Close>
                </div>
                <nav className="space-y-6">
                  <Link href="/collectie?flag=new" className="block font-display text-2xl">Nieuw binnen</Link>
                  {categories.map((c) => (
                    <div key={c.id}>
                      <Link href={`/collectie/${c.slug}`} className="block font-display text-2xl">{c.name}</Link>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {c.children?.map((s) => (
                          <Link key={s.id} href={`/collectie/${s.slug}`} className="text-sm text-taupe hover:text-charcoal">{s.name}</Link>
                        ))}
                      </div>
                    </div>
                  ))}
                  <Link href="/collectie?type=preorder" className="block font-display text-2xl">Pre-order</Link>
                  <div className="space-y-2 border-t pt-6 text-sm">
                    <Link href="/volg-bestelling" className="block">Bestelling volgen</Link>
                    <Link href={isLoggedIn ? "/account" : "/login"} className="block">{isLoggedIn ? "Mijn account" : "Inloggen / registreren"}</Link>
                    <Link href="/contact" className="block">Contact</Link>
                  </div>
                </nav>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <button className="p-2" aria-label="Zoeken" onClick={() => setSearchOpen((s) => !s)}><Search className="h-5 w-5" /></button>
        </div>

        <Logo className="lg:mr-6" />

        <nav className="hidden flex-1 items-center gap-7 text-[13px] font-medium uppercase tracking-[0.14em] lg:flex" aria-label="Hoofdnavigatie">
          <Link href="/collectie?flag=new" className="hover:text-taupe">Nieuw</Link>
          {categories.map((c) => (
            <div key={c.id} className="group relative">
              <Link href={`/collectie/${c.slug}`} className="py-7 hover:text-taupe">{c.name}</Link>
              {!!c.children?.length && (
                <div className="invisible absolute left-1/2 top-full z-50 w-56 -translate-x-1/2 border bg-white p-4 opacity-0 shadow-sm transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                  {c.children.map((s) => (
                    <Link key={s.id} href={`/collectie/${s.slug}`} className="block py-1.5 text-xs normal-case tracking-normal text-taupe hover:text-charcoal">{s.name}</Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          <Link href="/collectie?type=preorder" className="text-taupe hover:text-charcoal">Pre-order</Link>
        </nav>

        <div className="flex items-center gap-1">
          <button className="hidden p-2 lg:block" aria-label="Zoeken" onClick={() => setSearchOpen((s) => !s)}><Search className="h-5 w-5" /></button>
          <Link href={isLoggedIn ? "/account" : "/login"} className="hidden p-2 sm:block" aria-label="Account"><User className="h-5 w-5" /></Link>
          <Link href="/winkelwagen" className="relative -mr-2 p-2" aria-label={`Winkelwagen (${count} artikelen)`}>
            <ShoppingBag className="h-5 w-5" />
            {ready && count > 0 && (
              <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-semibold text-charcoal">{count}</span>
            )}
          </Link>
        </div>
      </div>
      {searchOpen && (
        <form
          className="container border-b py-3"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q");
            router.push(`/collectie?q=${encodeURIComponent(String(q ?? ""))}`);
          }}
        >
          <label htmlFor="site-search" className="sr-only">Zoeken</label>
          <input id="site-search" name="q" autoFocus placeholder="Zoek op product, merk of artikelnummer…" className="h-11 w-full border-0 border-b border-charcoal/20 bg-transparent text-base focus:border-charcoal focus:outline-none focus-visible:ring-0" />
        </form>
      )}
    </header>
  );
}
