"use client";

import { useActionState, useId, useState } from "react";
import { Check, LogOut, X } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import {
  EmptyRoleNote,
  RosterGroupHeading,
  RosterPlayerRow,
  type PlayerStatus,
  type RosterPlayer,
} from "@/components/roster/roster-player-row";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import type { FormState } from "@/lib/auth/schemas";
import { formatDelta, formatInt } from "@/lib/format";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import { ROLE_LABEL_SINGULAR, ROLE_ORDER } from "@/lib/roles";

export type RosterOption = RosterPlayer;

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
  statuses = {},
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
  /** Availability chip per player id (plain object: this is a client component). */
  statuses?: Record<number, PlayerStatus>;
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
    <div className="flex flex-col gap-5">
      {ROLE_ORDER.map((role) => {
        const players = roster.filter((r) => r.role === role);
        const headingId = `${uid}-${role}`;
        return (
          <section key={role} aria-labelledby={headingId}>
            <RosterGroupHeading
              id={headingId}
              role={role}
              count={players.length}
              target={composition[role]}
              missing={slots[role]}
            />
            {players.length === 0 ? (
              <EmptyRoleNote role={role} />
            ) : (
              <ul className="grid gap-2 lg:grid-cols-2">
                {players.map((r) => {
                  const canSell = r.outOfList || sessionOpen;
                  const isChosen = selected === r.id;
                  const label = r.outOfList ? "Svincola gratis" : "Svincola";
                  return (
                    <li key={r.id}>
                      <RosterPlayerRow
                        player={r}
                        status={r.outOfList ? undefined : statuses[r.id]}
                        className={isChosen ? "border-primary bg-primary/10" : undefined}
                        actions={
                          canSell ? (
                            <button
                              type="button"
                              onClick={() => setSelected(isChosen ? null : r.id)}
                              aria-pressed={isChosen}
                              aria-label={`${label} ${r.name}`}
                              className="text-primary focus-visible:ring-primary inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] px-2 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none"
                            >
                              <LogOut className="size-3.5" aria-hidden />
                              {label}
                            </button>
                          ) : undefined
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
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
              Poi dovrai prendere un {ROLE_LABEL_SINGULAR[chosen.role].toLowerCase()} tra gli
              svincolati per tornare in regola.
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
