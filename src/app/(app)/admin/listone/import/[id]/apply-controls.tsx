"use client";

import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { applyQuotationsImport, discardQuotationsImport } from "@/lib/import/actions";

export function ApplyControls({ importId }: { importId: string }) {
  const [state, action, pending] = useActionState(applyQuotationsImport, undefined);

  return (
    <div className="border-line bg-surface flex flex-col gap-3 rounded-[var(--radius-card)] border p-4">
      <FormMessage>{state?.message}</FormMessage>
      <div className="flex flex-col gap-2 sm:flex-row">
        <form action={action} className="contents">
          <input type="hidden" name="importId" value={importId} />
          <Button type="submit" disabled={pending} className="sm:min-w-56">
            <Check className="size-4" aria-hidden />
            {pending ? "Applicazione…" : "Conferma e aggiorna il listone"}
          </Button>
        </form>
        <form action={discardQuotationsImport} className="contents">
          <input type="hidden" name="importId" value={importId} />
          <Button type="submit" variant="secondary" disabled={pending}>
            <X className="size-4" aria-hidden />
            Annulla import
          </Button>
        </form>
      </div>
    </div>
  );
}
