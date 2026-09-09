"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Check, Search } from "lucide-react";
import { RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { formatDelta, formatInt } from "@/lib/format";
import { normalizeName } from "@/lib/import/name-matching";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import type { FreeAgentOption } from "@/lib/market/queries";
import type { FormState } from "@/lib/auth/schemas";
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

/**
 * Two-tap swap: pick who leaves, pick who comes in (same role, searchable),
 * confirm with the credits before/after. Works for regular and free swaps.
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

  const out = roster.find((r) => r.id === outId) ?? null;
  const inPlayer = candidates.find((c) => c.id === inId) ?? null;
  const refund = out ? (refundRule === "price_paid" ? out.pricePaid : out.qtA) : 0;
  const cost = inPlayer?.qtA ?? 0;
  const after = credits + refund - cost;

  const q = normalizeName(query);
  const options = out
    ? candidates
        .filter((c) => c.role === out.role && c.id !== out.id)
        .filter((c) => !q || normalizeName(c.name).includes(q))
        .slice(0, 60)
    : [];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="playerOut" value={outId ?? ""} />
      <input type="hidden" name="playerIn" value={inId ?? ""} />

      <div>
        <h3 className="font-display text-base font-semibold">{title}</h3>
        <p className="text-muted text-sm">{description}</p>
      </div>

      <section aria-labelledby="swap-out">
        <h4 id="swap-out" className="text-muted mb-2 text-xs font-semibold uppercase">
          1. Chi esce
        </h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {roster.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setOutId(r.id);
                setInId(null);
                setQuery("");
              }}
              aria-pressed={outId === r.id}
              className={cn(
                "border-line flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] border px-3 text-left text-sm",
                outId === r.id ? "border-primary bg-primary/10" : "hover:border-primary/50",
              )}
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
      </section>

      {out && (
        <section aria-labelledby="swap-in">
          <h4 id="swap-in" className="text-muted mb-2 text-xs font-semibold uppercase">
            2. Chi entra ({out.role}, rientro {formatInt(refund)})
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
            <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
              {options.map((c) => {
                const affordable = credits + refund - c.qtA >= 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setInId(c.id)}
                    disabled={!affordable}
                    aria-pressed={inId === c.id}
                    className={cn(
                      "border-line flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] border px-3 text-left text-sm disabled:opacity-40",
                      inId === c.id ? "border-primary bg-primary/10" : "hover:border-primary/50",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="text-muted block text-xs">{c.team}</span>
                    </span>
                    <span className="tabular font-semibold">{formatInt(c.qtA)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {out && inPlayer && (
        <section
          aria-labelledby="swap-confirm"
          className="border-primary/40 bg-primary/5 rounded-[var(--radius-card)] border p-4"
        >
          <h4 id="swap-confirm" className="text-muted mb-2 text-xs font-semibold uppercase">
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
            {state?.message ?? state?.errors?.playerIn?.[0]}
          </FormMessage>
          <Button type="submit" disabled={pending || after < 0} className="mt-3 w-full sm:w-auto">
            <Check className="size-4" aria-hidden />
            {pending ? "Conferma in corso…" : submitLabel}
          </Button>
        </section>
      )}
    </form>
  );
}
