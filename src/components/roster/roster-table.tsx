import { RoleBadge, Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatInt } from "@/lib/format";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import { ROLE_LABEL, ROLE_ORDER, type RosterRow } from "@/lib/teams/queries";

/** Roster grouped by role. `actions` renders an optional trailing cell per row (admin). */
export function RosterTable({
  roster,
  composition,
  actions,
}: {
  roster: RosterRow[];
  composition: Record<RoleClassic, number>;
  actions?: (row: RosterRow) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {ROLE_ORDER.map((role) => {
        const rows = roster.filter((r) => r.player.role_classic === role);
        const target = composition[role];
        const ok = rows.length === target;
        return (
          <section key={role} aria-labelledby={`role-${role}`}>
            <div className="mb-2 flex items-center gap-2">
              <RoleBadge role={role} />
              <h3 id={`role-${role}`} className="font-display text-sm font-semibold">
                {ROLE_LABEL[role]}
              </h3>
              <span className={`tabular text-xs ${ok ? "text-muted" : "text-danger"}`}>
                {rows.length}/{target}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="text-muted px-1 text-sm">Nessun {ROLE_LABEL[role].toLowerCase()}.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Calciatore</TH>
                    <TH>Squadra</TH>
                    <TH className="text-right">Pagato</TH>
                    <TH className="text-right">Qt.A</TH>
                    {actions && <TH className="text-right">Azioni</TH>}
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.rosterId}>
                      <TD className="font-medium">
                        {r.player.name}
                        {r.player.status === "out_of_list" && (
                          <Badge variant="danger" className="ml-2">
                            fuori lista
                          </Badge>
                        )}
                      </TD>
                      <TD className="text-muted">{r.player.team}</TD>
                      <TD className="tabular text-right">{formatInt(r.pricePaid)}</TD>
                      <TD className="tabular text-right font-semibold">
                        {formatInt(r.player.qt_a)}
                      </TD>
                      {actions && <TD className="text-right">{actions(r)}</TD>}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
        );
      })}
    </div>
  );
}
