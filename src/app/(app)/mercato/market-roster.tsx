"use client";

import { useActionState, useId, useState } from "react";
import { Check, LogOut, X } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import type { FormState } from "@/lib/auth/schemas";
import { formatDelta, formatInt } from "@/lib/format";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import { ROLE_LABEL, ROLE_ORDER } from "@/lib/roles";
import { cn } from "@/lib/utils";

export interface RosterOption {
  id: number;
  name: string;
  team: string;
  role: RoleClassic;
  qtA: number;
  pricePaid: number;
  outOfList: boolean;
}

const rowClass =
  "border-line flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] border px-3 text-sm";

/**
 * The manager's roster during the market, grouped by role with the holes to
 * fill. Each active player can be released (session open: credits back at the
 * current Qt.A); each out-of-list player can be released for free at any time
 * (refund = price paid). One confirmation step per row.
 */
export function MarketRoster({
  teamId,
  credits,
  roster,
  composition,
  slots,
  sessionOpen,
  refundRule,
  sellAction,
  releaseAction,
}: {
  teamId: string;
  credits: number;
  roster: RosterOption[];
  composition: Record<RoleClassic, number>;
  slots: Record<RoleClassic, number>;
  sessionOpen: boolean;
  refundRule: "current_quotation" | "price_paid";
  sellAction: (prev: FormState, formData: FormData) => Promise<FormState>;
  releaseAction: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [sellState, sellForm, selling] = useActionState(sellAction, undefined);
  const [releaseState, releaseForm, releasing] = useActionState(releaseAction, undefined);
  const [selected, setSelected] = useState<number | null>(null);
  const uid = useId();
  const pending = selling || releasing;

  const chosen = roster.find((r) => r.id === selected) ?? null;
  const refund = chosen
    ? chosen.outOfList || refundRule === "price_paid"
      ? chosen.pricePaid
      : chosen.qtA
    : 0;
  const message =
    sellState?.message ??
    sellState?.errors?.playerId?.[0] ??
    releaseState?.message ??
    releaseState?.errors?.playerId?.[0];

  return (
    <div className="flex flex-col gap-4">
      {ROLE_ORDER.map((role) => {
        const players = roster.filter((r) => r.role === role);
        const missing = slots[role];
        const headingId = `${uid}-${role}`;
        return (
          <section key={role} aria-labelledby={headingId}>
            <h4
              id={headingId}
              className="text-muted mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase"
            >
              <RoleBadge role={role} className="size-5 text-[10px]" />
              {ROLE_LABEL[role]}
              <span className="tabular">
                {formatInt(players.length)}/{formatInt(composition[role])}
              </span>
              {missing > 0 && (
                <span className="text-danger normal-case">
                  {missing === 1 ? "1 posto da riempire" : `${missing} posti da riempire`}
                </span>
              )}
              {missing < 0 && (
                <span className="text-danger normal-case">{-missing} in più della regola</span>
              )}
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {players.map((r) => {
                const canSell = r.outOfList || sessionOpen;
                const isChosen = selected === r.id;
                return (
                  <div
                    key={r.id}
                    className={cn(rowClass, isChosen && "border-primary bg-primary/10")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="text-muted block text-xs">
                        {r.team} · pagato {formatInt(r.pricePaid)}
                        {r.outOfList ? " · fuori lista" : ""}
                      </span>
                    </span>
                    <span className="tabular font-semibold">{formatInt(r.qtA)}</span>
                    {canSell && (
                      <button
                        type="button"
                        onClick={() => setSelected(isChosen ? null : r.id)}
                        aria-pressed={isChosen}
                        aria-label={`${r.outOfList ? "Svincola gratis" : "Svincola"} ${r.name}`}
                        className="text-primary inline-flex min-h-11 items-center gap-1 text-xs font-semibold"
                      >
                        <LogOut className="size-3.5" aria-hidden />
                        {r.outOfList ? "Svincola gratis" : "Svincola"}
                      </button>
                    )}
                  </div>
                );
              })}
              {players.length === 0 && (
                <p className="text-muted text-sm">
                  Nessun {ROLE_LABEL[role].toLowerCase()} in rosa.
                </p>
              )}
            </div>
          </section>
        );
      })}

      {chosen && (
        <Reveal className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom)+0.5rem)] z-10 lg:static">
          <form
            action={chosen.outOfList ? releaseForm : sellForm}
            className="border-primary/40 bg-surface rounded-[var(--radius-card)] border p-4 shadow-lg"
            aria-labelledby={`${uid}-confirm`}
          >
            <input type="hidden" name="teamId" value={teamId} />
            <input type="hidden" name="playerId" value={chosen.id} />
            <h4 id={`${uid}-confirm`} className="text-muted mb-2 text-xs font-semibold uppercase">
              Conferma lo svincolo
            </h4>
            <p className="text-sm">
              <span className="font-medium">{chosen.name}</span> esce dalla rosa
              {chosen.outOfList
                ? ": rimborso del prezzo pagato, non conta nei cambi."
                : ": incassi la quotazione attuale."}
            </p>
            <p className="tabular mt-2 text-sm">
              Crediti: {formatInt(credits)} {formatDelta(refund)} ={" "}
              <span className="font-display text-primary text-lg font-semibold">
                {formatInt(credits + refund)}
              </span>
            </p>
            <p className="text-muted mt-1 text-xs">
              Poi dovrai prendere un {ROLE_LABEL[chosen.role].toLowerCase()} tra gli svincolati per
              tornare in regola.
            </p>
            <FormMessage className="mt-3">{message}</FormMessage>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button type="submit" disabled={pending}>
                <Check className="size-4" aria-hidden />
                {pending ? "Svincolo in corso…" : "Conferma lo svincolo"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
                <X className="size-4" aria-hidden /> Annulla
              </Button>
            </div>
          </form>
        </Reveal>
      )}
    </div>
  );
}
