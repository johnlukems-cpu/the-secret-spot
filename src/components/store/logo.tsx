import Link from "next/link";
import { cn } from "@/lib/utils";

/** TSG monogram – as on the cap in the brand illustration. */
export function LogoMark({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  const fill = tone === "light" ? "#F8EDE4" : "#7B0F2B";
  const text = tone === "light" ? "#4A0B1C" : "#F8EDE4";
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("h-9 w-9", className)}>
      <circle cx="20" cy="20" r="19.5" fill={fill} />
      <circle cx="20" cy="20" r="16.5" fill="none" stroke={text} strokeOpacity="0.45" strokeWidth="0.6" />
      <text x="20" y="25.2" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="13" letterSpacing="-0.6" fill={text}>TSG</text>
    </svg>
  );
}

export function Logo({ className, tone = "dark", withTagline = false }: { className?: string; tone?: "dark" | "light"; withTagline?: boolean }) {
  return (
    <Link href="/" aria-label="THE SECRET GIRL – home" className={cn("inline-flex items-center gap-2.5", tone === "light" ? "text-cream" : "text-charcoal", className)}>
      <LogoMark tone={tone} />
      <span className="flex flex-col leading-none">
        <span className="text-[9px] font-medium tracking-[0.5em]">THE</span>
        <span className="font-display text-xl font-semibold tracking-[0.14em] sm:text-2xl">
          SECRET <span className="italic tracking-[0.06em]">Girl</span>
        </span>
        {withTagline && <span className="mt-1 text-[9px] tracking-[0.35em] text-gold">YOUR STYLE. YOUR SECRET.</span>}
      </span>
    </Link>
  );
}
