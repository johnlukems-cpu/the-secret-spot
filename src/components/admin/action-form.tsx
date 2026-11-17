"use client";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/admin/action-types";

/**
 * Generic form bound to a server action returning ActionResult.
 * Shows toasts, field errors (via data-error lookups) and optionally resets.
 */
export function ActionForm({ action, children, className, successMessage = "Opgeslagen", reset = false, confirm }: {
  action: (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
  children: React.ReactNode; className?: string; successMessage?: string; reset?: boolean; confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message ?? successMessage);
      if (reset) ref.current?.reset();
    } else {
      toast.error(state.error);
    }
  }, [state, successMessage, reset]);
  return (
    <form ref={ref} action={formAction} className={className}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {children}
      {state && !state.ok && state.fieldErrors && (
        <ul className="mt-2 space-y-0.5 text-xs text-destructive">
          {Object.entries(state.fieldErrors).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
        </ul>
      )}
    </form>
  );
}
