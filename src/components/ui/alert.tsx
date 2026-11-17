import * as React from "react";
import { cn } from "@/lib/utils";

export function Alert({ variant = "info", className, ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: "info" | "warning" | "error" | "success" }) {
  const styles = {
    info: "border-gold/60 bg-cream text-charcoal",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-red-300 bg-red-50 text-red-800",
    success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  }[variant];
  return <div role={variant === "error" ? "alert" : "status"} className={cn("rounded-md border px-4 py-3 text-sm", styles, className)} {...props} />;
}
