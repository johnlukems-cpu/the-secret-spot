"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Icons from "lucide-react";
import { LogoMark } from "@/components/store/logo";
import { cn } from "@/lib/utils";

type NavGroup = { group: string; items: { href: string; label: string; icon: string }[] };

export function AdminSidebar({ nav, user }: { nav: NavGroup[]; user: { email: string | null; roles: string[] } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const content = (
    <nav className="space-y-6 text-sm" aria-label="Admin">
      {nav.map((g) => (
        <div key={g.group}>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-cream/40">{g.group}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[it.icon] ?? Icons.Circle;
              const active = it.href === "/admin" ? pathname === "/admin" : pathname.startsWith(it.href);
              return (
                <li key={it.href}>
                  <Link href={it.href} onClick={() => setOpen(false)}
                    className={cn("flex items-center gap-2.5 rounded-md px-3 py-2 text-cream/80 transition hover:bg-cream/10 hover:text-cream", active && "bg-cream/10 text-gold")}>
                    <Icon className="h-4 w-4" /> {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between bg-charcoal px-4 text-cream lg:hidden">
        <Link href="/admin" className="flex items-center gap-2 font-display text-lg tracking-widest"><LogoMark className="h-6 w-6" /> ADMIN</Link>
        <button onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>{open ? <Icons.X /> : <Icons.Menu />}</button>
      </div>
      {open && <div className="fixed inset-0 top-14 z-30 overflow-y-auto bg-charcoal p-4 lg:hidden">{content}</div>}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto bg-charcoal p-4 lg:flex">
        <Link href="/admin" className="mb-6 flex items-center gap-2 px-2 text-cream">
          <LogoMark className="h-7 w-7" />
          <span className="font-display text-lg tracking-[0.2em]">SECRET SPOT</span>
        </Link>
        <div className="flex-1">{content}</div>
        <div className="mt-6 border-t border-cream/10 px-3 pt-4 text-xs text-cream/60">
          <p className="truncate">{user.email}</p>
          <p className="truncate text-cream/40">{user.roles.filter((r) => r !== "customer").join(", ")}</p>
          <div className="mt-2 flex gap-3"><Link href="/" className="underline">Winkel</Link><Link href="/account" className="underline">Account</Link></div>
        </div>
      </aside>
    </>
  );
}
