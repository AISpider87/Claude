"use client";

import { useActionState } from "react";
import { Undo2 } from "lucide-react";
import { enterDelay } from "@/components/roster/roster-player-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { formatDelta } from "@/lib/format";
import { undoPendingOperation } from "@/lib/market/actions";

export interface PendingRow {
  id: string;
  kind: "sell" | "buy" | "free_release" | string;
  label: string;
  counts: boolean;
  /** Out-of-list release, or the purchase filling the slot it left. */
  free: boolean;
  creditsDelta: number;
}

function UndoButton({ txId, label }: { txId: string; label: string }) {
  const [state, action, pending] = useActionState(undoPendingOperation, undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="txId" value={txId} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Annulla: ${label}`}
      >
        <Undo2 className="size-4" aria-hidden /> {pending ? "…" : "Annulla"}
      </Button>
      {state?.status === "error" && <FormMessage>{state.message}</FormMessage>}
    </form>
  );
}

/**
 * The manager's operations of the open session, not yet final: each one can be
 * undone until the session closes; at the closing they become definitive and
 * the purchases count toward the season limit. Free operations (out-of-list)
 * are in here too — a manager reported not finding them anywhere — marked as
 * free, because they never count toward the 20.
 */
export function PendingOperations({ rows }: { rows: PendingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r, i) => (
        <li
          key={r.id}
          style={enterDelay(i)}
          className="row-lit border-line enter-row flex min-h-11 min-w-0 items-center gap-2 rounded-[var(--radius-control)] border px-2 text-sm"
        >
          <Badge
            variant={r.kind === "buy" ? "primary" : "neutral"}
            className="shrink-0 px-1.5 text-[10px]"
          >
            {r.kind === "buy" ? "Acquisto" : "Svincolo"}
          </Badge>
          {r.free && (
            <Badge variant="muted" className="shrink-0 px-1.5 text-[10px]">
              gratuito
            </Badge>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {r.label}
            {r.kind === "buy" && r.counts && (
              <span className="text-muted"> · conterà 1 cambio</span>
            )}
            {r.free && <span className="text-muted"> · non conta nei cambi</span>}
          </span>
          <span
            className={`tabular font-semibold ${r.creditsDelta < 0 ? "text-danger" : "text-primary"}`}
          >
            {formatDelta(r.creditsDelta)}
          </span>
          <UndoButton txId={r.id} label={r.label} />
        </li>
      ))}
    </ul>
  );
}
