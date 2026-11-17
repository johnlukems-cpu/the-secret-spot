import Link from "next/link";
import { cn } from "@/lib/utils";

/** Keyhole monogram – the "secret spot". */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("h-8 w-8", className)}>
      <circle cx="20" cy="20" r="19" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="20" cy="16" r="5" fill="#D8C49A" />
      <path d="M17.2 19.5h5.6l1.6 10.5h-8.8z" fill="#D8C49A" />
    </svg>
  );
}

export function Logo({ className, tone = "dark", withTagline = false }: { className?: string; tone?: "dark" | "light"; withTagline?: boolean }) {
  return (
    <Link href="/" aria-label="THE SECRET SPOT – home" className={cn("inline-flex items-center gap-2.5", tone === "light" ? "text-cream" : "text-charcoal", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-[9px] font-medium tracking-[0.5em]">THE</span>
        <span className="font-display text-xl font-semibold tracking-[0.18em] sm:text-2xl">SECRET SPOT</span>
        {withTagline && <span className="mt-1 text-[9px] tracking-[0.35em] text-gold">YOUR STYLE. YOUR SECRET.</span>}
      </span>
    </Link>
  );
}
