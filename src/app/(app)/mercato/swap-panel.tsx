"use client";

import { useActionState, useId, useState } from "react";
import { ArrowRight, Check, Pencil, Search } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { formatDelta, formatInt } from "@/lib/format";
import { normalizeName } from "@/lib/import/name-matching";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import type { FreeAgentOption } from "@/lib/market/queries";
import type { FormState } from "@/lib/auth/schemas";
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

const MAX_OPTIONS = 60;

const tileClass =
  "border-line flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] border px-3 text-left text-sm transition-colors";

/**
 * Two-tap swap: pick who leaves (filter by role, the list collapses once
 * chosen), pick who comes in (same role, searchable), confirm with the credits
 * before/after in a bar that stays on screen. Works for regular and free swaps.
 */
export function SwapPanel({
  teamId,
  credits,
  roster,
  candidates,
  refundRule,
  action,
  title,
  description,
  submitLabel,
}: {
  teamId: string;
  credits: number;
  roster: RosterOption[];
  candidates: FreeAgentOption[];
  refundRule: "current_quotation" | "price_paid";
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  title: string;
  description: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [outId, setOutId] = useState<number | null>(null);
  const [inId, setInId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleClassic | null>(null);
  const uid = useId();
  const ids = {
    out: `${uid}-out`,
    in: `${uid}-in`,
    confirm: `${uid}-confirm`,
    why: (id: number) => `${uid}-why-${id}`,
  };

  const out = roster.find((r) => r.id === outId) ?? null;
  const inPlayer = candidates.find((c) => c.id === inId) ?? null;
  const refund = out ? (refundRule === "price_paid" ? out.pricePaid : out.qtA) : 0;
  const cost = inPlayer?.qtA ?? 0;
  const after = credits + refund - cost;

  const rolesPresent = ROLE_ORDER.filter((role) => roster.some((r) => r.role === role));
  const rosterShown = roster.filter((r) => !roleFilter || r.role === roleFilter);

  const q = normalizeName(query);
  const matching = out
    ? candidates
        .filter((c) => c.role === out.role && c.id !== out.id)
        .filter((c) => !q || normalizeName(c.name).includes(q))
    : [];
  const options = matching.slice(0, MAX_OPTIONS);

  function chooseOut(id: number) {
    setOutId(id);
    setInId(null);
    setQuery("");
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="playerOut" value={outId ?? ""} />
      <input type="hidden" name="playerIn" value={inId ?? ""} />

      <div>
        <h3 className="font-display text-base font-semibold">{title}</h3>
        <p className="text-muted text-sm">{description}</p>
      </div>

      <section aria-labelledby={ids.out}>
        <h4 id={ids.out} className="text-muted mb-2 text-xs font-semibold uppercase">
          1. Chi esce
        </h4>
        {out ? (
          <div className={cn(tileClass, "border-primary bg-primary/10")}>
            <RoleBadge role={out.role} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{out.name}</span>
              <span className="text-muted block text-xs">
                {out.team} · pagato {formatInt(out.pricePaid)} · rientro {formatInt(refund)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setOutId(null);
                setInId(null);
              }}
              className="text-primary inline-flex min-h-11 items-center gap-1 text-xs font-semibold"
            >
              <Pencil className="size-3.5" aria-hidden /> Cambia
            </button>
          </div>
        ) : (
          <>
            {rolesPresent.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Filtra per ruolo">
                {rolesPresent.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setRoleFilter(roleFilter === role ? null : role)}
                    aria-pressed={roleFilter === role}
                    className={cn(
                      "border-line inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm",
                      roleFilter === role
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted",
                    )}
                  >
                    <RoleBadge role={role} className="size-5 text-[10px]" /> {ROLE_LABEL[role]}
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {rosterShown.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => chooseOut(r.id)}
                  className={cn(tileClass, "hover:border-primary/50")}
                >
                  <RoleBadge role={r.role} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="text-muted block text-xs">
                      {r.team} · pagato {formatInt(r.pricePaid)}
                      {r.outOfList ? " · fuori lista" : ""}
                    </span>
                  </span>
                  <span className="tabular font-semibold">{formatInt(r.qtA)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {out && (
        <Reveal>
          <section aria-labelledby={ids.in}>
            <h4 id={ids.in} className="text-muted mb-2 text-xs font-semibold uppercase">
              2. Chi entra ({ROLE_LABEL[out.role].toLowerCase()}, hai {formatInt(credits + refund)}{" "}
              crediti)
            </h4>
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
              <p className="text-muted text-sm">Nessuno svincolato di questo ruolo corrisponde.</p>
            ) : (
              <>
                <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {options.map((c) => {
                    const affordable = credits + refund - c.qtA >= 0;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setInId(c.id)}
                        disabled={!affordable}
                        aria-pressed={inId === c.id}
                        aria-describedby={affordable ? undefined : ids.why(c.id)}
                        className={cn(
                          tileClass,
                          "disabled:opacity-50",
                          inId === c.id
                            ? "border-primary bg-primary/10"
                            : "hover:border-primary/50",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{c.name}</span>
                          <span className="text-muted block text-xs">
                            {c.team}
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
                    Mostrati i primi {MAX_OPTIONS} di {formatInt(matching.length)}: affina la
                    ricerca per trovare gli altri.
                  </p>
                )}
              </>
            )}
          </section>
        </Reveal>
      )}

      {out && inPlayer && (
        <Reveal className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom)+0.5rem)] z-10 lg:static">
          <section
            aria-labelledby={ids.confirm}
            className="border-primary/40 bg-surface rounded-[var(--radius-card)] border p-4 shadow-lg"
          >
            <h4 id={ids.confirm} className="text-muted mb-2 text-xs font-semibold uppercase">
              3. Conferma
            </h4>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{out.name}</span>
              <ArrowRight className="text-primary size-4" aria-hidden />
              <span className="font-medium">{inPlayer.name}</span>
            </p>
            <p className="tabular mt-2 text-sm">
              Crediti: {formatInt(credits)} {formatDelta(refund)} {formatDelta(-cost)} ={" "}
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
              {state?.message ?? state?.errors?.playerIn?.[0] ?? state?.errors?.playerOut?.[0]}
            </FormMessage>
            <Button type="submit" disabled={pending || after < 0} className="mt-3 w-full sm:w-auto">
              <Check className="size-4" aria-hidden />
              {pending ? "Conferma in corso…" : submitLabel}
            </Button>
          </section>
        </Reveal>
      )}
    </form>
  );
}
