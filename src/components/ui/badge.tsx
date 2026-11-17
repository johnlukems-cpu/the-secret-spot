import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide", {
  variants: {
    variant: {
      default: "bg-charcoal text-cream",
      gold: "bg-gold text-charcoal",
      cream: "bg-cream text-charcoal",
      outline: "border border-charcoal/20 text-charcoal",
      success: "bg-emerald-50 text-emerald-800",
      warning: "bg-amber-50 text-amber-800",
      danger: "bg-red-50 text-red-700",
      info: "bg-sky-50 text-sky-800",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
