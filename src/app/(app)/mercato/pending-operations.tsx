"use client";

import { useActionState } from "react";
import { Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { formatDelta } from "@/lib/format";
import { undoPendingOperation } from "@/lib/market/actions";

export interface PendingRow {
  id: string;
  kind: "sell" | "buy" | string;
  label: string;
  counts: boolean;
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
 * the purchases count toward the season limit.
 */
export function PendingOperations({ rows }: { rows: PendingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.id}
          className="border-line flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] border px-3 text-sm"
        >
          <Badge variant={r.kind === "buy" ? "primary" : "neutral"}>
            {r.kind === "buy" ? "Acquisto" : "Svincolo"}
          </Badge>
          <span className="min-w-0 flex-1 truncate">
            {r.label}
            {r.kind === "buy" && r.counts && (
              <span className="text-muted"> · conterà 1 cambio</span>
            )}
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
