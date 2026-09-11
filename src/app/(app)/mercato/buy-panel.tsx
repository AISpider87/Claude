"use client";

import { useActionState, useId, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { PlayerAvatar } from "@/components/players/player-avatar";
import { RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/auth/schemas";
import { formatDelta, formatInt } from "@/lib/format";
import { normalizeName } from "@/lib/import/name-matching";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import { ROLE_LABEL, ROLE_ORDER } from "@/lib/roles";
import { cn } from "@/lib/utils";

export interface BuyCandidate {
  id: number;
  name: string;
  team: string;
  role: RoleClassic;
  qtA: number;
  /** Fills a free slot (from a free release): does not count toward the limit. */
  free: boolean;
}

const MAX_OPTIONS = 60;
const tileClass =
  "avatar-host border-line flex min-h-12 w-full items-center gap-2.5 rounded-[var(--radius-control)] border py-1.5 pr-3 pl-2 text-left text-sm transition-colors";

/**
 * Free agents the team can buy right now: only the roles with a hole, searchable,
 * with the credits before/after in a confirmation bar that stays on screen.
 */
export function BuyPanel({
  teamId,
  credits,
  candidates,
  openRoles,
  action,
}: {
  teamId: string;
  credits: number;
  candidates: BuyCandidate[];
  /** Roles with at least one hole, in display order. */
  openRoles: RoleClassic[];
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [inId, setInId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleClassic | null>(
    openRoles.length === 1 ? openRoles[0]! : null,
  );
  const uid = useId();
  const ids = {
    list: `${uid}-list`,
    confirm: `${uid}-confirm`,
    why: (id: number) => `${uid}-why-${id}`,
  };

  const chosen = candidates.find((c) => c.id === inId) ?? null;
  const cost = chosen?.qtA ?? 0;
  const after = credits - cost;

  const q = normalizeName(query);
  const matching = candidates
    .filter((c) => !roleFilter || c.role === roleFilter)
    .filter((c) => !q || normalizeName(c.name).includes(q));
  const options = matching.slice(0, MAX_OPTIONS);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="playerId" value={inId ?? ""} />

      <section aria-labelledby={ids.list}>
        <h4 id={ids.list} className="text-muted mb-2 text-xs font-semibold uppercase">
          Svincolati che puoi prendere (hai {formatInt(credits)} crediti)
        </h4>
        {openRoles.length > 1 && (
          <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Filtra per ruolo">
            {ROLE_ORDER.filter((r) => openRoles.includes(r)).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setRoleFilter(roleFilter === role ? null : role)}
                aria-pressed={roleFilter === role}
                className={cn(
                  "border-line inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm",
                  roleFilter === role ? "border-primary bg-primary/10 text-primary" : "text-muted",
                )}
              >
                <RoleBadge role={role} className="size-5 text-[10px]" /> {ROLE_LABEL[role]}
              </button>
            ))}
          </div>
        )}
        <label className="relative mb-2 block">
          <Search
            className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca tra gli svincolati…"
            className="pl-9"
            aria-label="Cerca tra gli svincolati"
            autoComplete="off"
          />
        </label>
        {options.length === 0 ? (
          <p className="text-muted text-sm">Nessuno svincolato corrisponde.</p>
        ) : (
          <>
            <div className="grid max-h-96 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {options.map((c) => {
                const affordable = credits - c.qtA >= 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setInId(inId === c.id ? null : c.id)}
                    disabled={!affordable}
                    aria-pressed={inId === c.id}
                    aria-describedby={affordable ? undefined : ids.why(c.id)}
                    className={cn(
                      tileClass,
                      "disabled:opacity-50",
                      inId === c.id ? "border-primary bg-primary/10" : "hover:border-primary/50",
                    )}
                  >
                    <PlayerAvatar
                      id={c.id}
                      name={c.name}
                      team={c.team}
                      role={c.role}
                      size="sm"
                      showRole={false}
                      idle={false}
                    />
                    <RoleBadge role={c.role} className="size-5 shrink-0 text-[10px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="text-muted block text-xs">
                        {c.team}
                        {c.free && " · non conta nei cambi"}
                        {!affordable && (
                          <span id={ids.why(c.id)} className="text-danger">
                            {" "}
                            · crediti insufficienti
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="tabular font-semibold">{formatInt(c.qtA)}</span>
                  </button>
                );
              })}
            </div>
            {matching.length > MAX_OPTIONS && (
              <p className="text-muted mt-2 text-xs">
                Mostrati i primi {MAX_OPTIONS} di {formatInt(matching.length)}: affina la ricerca
                per trovare gli altri.
              </p>
            )}
          </>
        )}
      </section>

      {chosen && (
        <Reveal className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom)+0.5rem)] z-10 lg:static">
          <section
            aria-labelledby={ids.confirm}
            className="border-primary/40 bg-surface rounded-[var(--radius-card)] border p-4 shadow-lg"
          >
            <h4 id={ids.confirm} className="text-muted mb-2 text-xs font-semibold uppercase">
              Conferma l&apos;acquisto
            </h4>
            <p className="text-sm">
              <span className="font-medium">{chosen.name}</span> entra in rosa
              {chosen.free ? " (sostituisce un fuori lista: non conta nei cambi)." : "."}
            </p>
            <p className="tabular mt-2 text-sm">
              Crediti: {formatInt(credits)} {formatDelta(-cost)} ={" "}
              <span
                className={cn(
                  "font-display text-lg font-semibold",
                  after < 0 ? "text-danger" : "text-primary",
                )}
              >
                {formatInt(after)}
              </span>
            </p>
            <FormMessage className="mt-3">
              {state?.message ?? state?.errors?.playerId?.[0]}
            </FormMessage>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button type="submit" disabled={pending || after < 0}>
                <Check className="size-4" aria-hidden />
                {pending ? "Acquisto in corso…" : "Conferma l'acquisto"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setInId(null)}>
                <X className="size-4" aria-hidden /> Annulla
              </Button>
            </div>
          </section>
        </Reveal>
      )}
    </form>
  );
}
