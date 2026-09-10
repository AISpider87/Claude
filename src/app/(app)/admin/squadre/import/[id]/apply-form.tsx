"use client";

import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { applyRostersImport, discardRostersImport } from "@/lib/import/rosters-actions";

/**
 * Wraps the per-team tables so the manual resolutions (selects / id inputs named
 * "res:<team>|<row>") travel with the confirmation.
 */
export function RostersApplyForm({
  importId,
  ready,
  unresolved,
  placeholders,
  children,
}: {
  importId: string;
  ready: boolean;
  unresolved: number;
  placeholders: number;
  children: React.ReactNode;
}) {
  const [state, action, pending] = useActionState(applyRostersImport, undefined);

  const controls = (
    <div className="border-line bg-surface flex flex-col gap-3 rounded-[var(--radius-card)] border p-4">
      {!ready && unresolved > 0 && (
        <FormMessage tone="info">
          {unresolved} nomi non hanno una corrispondenza certa: nelle righe evidenziate scegli il
          calciatore giusto oppure segnali come <strong>fuori lista</strong> (ha lasciato la Serie
          A: il manager lo svincola gratis recuperando il prezzo pagato).
        </FormMessage>
      )}
      {placeholders > 0 && (
        <FormMessage tone="info">
          {placeholders} calciatori segnati &quot;*&quot; nel file non sono nel listone: verranno
          importati come fuori lista.
        </FormMessage>
      )}
      <FormMessage>{state?.message}</FormMessage>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" form="rosters-apply" disabled={pending} className="sm:min-w-56">
          <Check className="size-4" aria-hidden />
          {pending ? "Applicazione…" : "Conferma e sostituisci le rose"}
        </Button>
        <Button type="submit" form="rosters-discard" variant="secondary" disabled={pending}>
          <X className="size-4" aria-hidden />
          Annulla import
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <form id="rosters-discard" action={discardRostersImport}>
        <input type="hidden" name="importId" value={importId} />
      </form>
      <form id="rosters-apply" action={action} className="flex flex-col gap-4">
        <input type="hidden" name="importId" value={importId} />
        {controls}
        {!ready && unresolved > 0 && (
          <label className="border-line bg-surface flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border p-4 text-sm">
            <input type="checkbox" name="ool_all" value="1" className="mt-1 size-4" />
            <span>
              <span className="font-medium">Segna tutti i nomi non trovati come fuori lista</span>
              <span className="text-muted block">
                Il ruolo viene dedotto dalla composizione 3/7/7/6 della squadra; se non è univoco ti
                chiederò di sceglierlo riga per riga.
              </span>
            </span>
          </label>
        )}
        {children}
        {controls}
      </form>
    </>
  );
}
