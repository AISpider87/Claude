import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, formatDelta } from "@/lib/format";
import type { LedgerRow } from "@/lib/market/queries";

export const KIND_LABEL: Record<string, string> = {
  swap: "Cambio",
  free_swap: "Cambio gratuito",
  sell: "Svincolo",
  buy: "Acquisto",
  free_release: "Svincolo gratuito",
  admin_assign: "Assegnazione admin",
  admin_remove: "Rimozione admin",
  admin_credits: "Crediti admin",
  reversal: "Annullamento",
};

export function describeTransaction(t: LedgerRow) {
  if (t.kind === "admin_credits") return t.note ?? "Rettifica crediti";
  const parts: string[] = [];
  if (t.playerOutName) parts.push(`esce ${t.playerOutName}`);
  if (t.playerInName) parts.push(`entra ${t.playerInName}`);
  return parts.join(" · ") || "—";
}

export function LedgerTable({
  rows,
  showTeam = true,
  actions,
}: {
  rows: LedgerRow[];
  showTeam?: boolean;
  actions?: (row: LedgerRow) => React.ReactNode;
}) {
  if (rows.length === 0) return <p className="text-muted text-sm">Nessuna operazione ancora.</p>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Quando</TH>
          {showTeam && <TH>Squadra</TH>}
          <TH>Operazione</TH>
          <TH>Dettaglio</TH>
          <TH className="text-right">Crediti</TH>
          {actions && <TH className="text-right">Azioni</TH>}
        </TR>
      </THead>
      <TBody>
        {rows.map((t) => (
          <TR key={t.id} className={t.reversed ? "opacity-60" : undefined}>
            <TD className="whitespace-nowrap">{formatDateTime(t.created_at)}</TD>
            {showTeam && <TD className="font-medium">{t.teamName}</TD>}
            <TD>
              <Badge
                variant={
                  t.kind === "reversal"
                    ? "danger"
                    : t.kind === "swap" || t.kind === "buy"
                      ? "primary"
                      : "neutral"
                }
              >
                {KIND_LABEL[t.kind] ?? t.kind}
              </Badge>
              {t.kind === "buy" && !t.counts_toward_limit && (
                <Badge variant="muted" className="ml-1">
                  gratuito
                </Badge>
              )}
              {t.reversed && (
                <Badge variant="muted" className="ml-1">
                  annullata
                </Badge>
              )}
            </TD>
            <TD>
              {describeTransaction(t)}
              {t.kind === "reversal" && t.note && (
                <span className="text-muted block text-xs">motivo: {t.note}</span>
              )}
            </TD>
            <TD
              className={`tabular text-right font-semibold ${t.credits_delta < 0 ? "text-danger" : t.credits_delta > 0 ? "text-primary" : ""}`}
            >
              {formatDelta(t.credits_delta)}
            </TD>
            {actions && <TD className="text-right">{actions(t)}</TD>}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
