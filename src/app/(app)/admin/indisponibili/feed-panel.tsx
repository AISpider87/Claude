"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Label } from "@/components/ui/label";
import { confirmPlayerMap, runAvailabilityNow } from "@/lib/availability/actions";
import type { PlayerOption } from "./status-form";

const controlClass =
  "border-line bg-surface min-h-11 w-full rounded-[var(--radius-control)] border px-3 text-sm";

/** Runs the same job the schedule runs and shows exactly what came back. */
export function RunFeedButton({ disabled }: { disabled?: boolean }) {
  const [state, action, pending] = useActionState(runAvailabilityNow, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <Button type="submit" disabled={pending || disabled}>
        <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} aria-hidden />
        {pending ? "Aggiornamento…" : "Aggiorna adesso"}
      </Button>
      {state?.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>
          {state.message}
        </FormMessage>
      )}
    </form>
  );
}

/**
 * The statement the admin pastes in the Supabase SQL Editor to start the
 * 15-minute schedule. It carries the token the database itself generated, so
 * nothing has to be read back from Vercel.
 */
export function CronSql({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <pre className="border-line bg-surface-2 max-h-64 overflow-auto rounded-[var(--radius-control)] border p-3 text-xs leading-relaxed">
        <code>{sql}</code>
      </pre>
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        onClick={() => {
          void navigator.clipboard
            .writeText(sql)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            })
            .catch(() => setCopied(false));
        }}
      >
        {copied ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        {copied ? "Copiato" : "Copia il comando"}
      </Button>
    </div>
  );
}

export interface UnmatchedRow {
  externalId: number | null;
  name: string;
  team: string;
  kind: "ambiguous" | "not_found";
  detail: string;
  suggestions: PlayerOption[];
}

/** One API name the job could not bind: the admin picks the right player. */
export function MapRowForm({
  row,
  players,
  provider,
}: {
  row: UnmatchedRow;
  players: PlayerOption[];
  provider: string;
}) {
  const [state, action, pending] = useActionState(confirmPlayerMap, undefined);
  const selectId = `map-${row.externalId ?? row.name.replace(/\W+/g, "-")}`;
  const options = row.suggestions.length > 0 ? row.suggestions : players;
  return (
    <form
      action={action}
      className="border-line flex flex-col gap-2 border-t py-3 first:border-t-0"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-medium">{row.name}</span>
        <span className="text-muted text-sm">
          {row.team || "club sconosciuto"} ·{" "}
          {row.kind === "ambiguous" ? "più candidati" : "nessun candidato"}
          {row.detail ? ` · ${row.detail}` : ""}
        </span>
      </div>
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="externalName" value={row.name} />
      <input type="hidden" name="externalId" value={row.externalId ?? ""} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor={selectId}>Abbina a</Label>
          <select id={selectId} name="playerId" required className={controlClass} defaultValue="">
            <option value="">— scegli dal listone —</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.role} · {p.team}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="ghost" disabled={pending || row.externalId == null}>
          <Link2 className="size-4" aria-hidden /> {pending ? "…" : "Abbina"}
        </Button>
      </div>
      {row.externalId == null && (
        <FormMessage tone="info">
          L&apos;API non ha dato un id per questo nome: non è abbinabile, comparirà di nuovo al
          prossimo aggiornamento.
        </FormMessage>
      )}
      {state?.message && (
        <FormMessage tone={state.status === "success" ? "success" : "error"}>
          {state.message}
        </FormMessage>
      )}
    </form>
  );
}
