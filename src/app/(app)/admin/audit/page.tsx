import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listAuditLog } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Audit log" };

const ACTION_LABEL: Record<string, string> = {
  "user.role": "Cambio ruolo",
  "user.active": "Attivazione/disattivazione account",
  "user.rename": "Cambio nome",
  "setting.update": "Impostazione modificata",
  "import.preview": "Anteprima import",
  "import.apply": "Import applicato",
  "import.fail": "Import annullato",
  "roster.import": "Rosa importata",
  "roster.assign": "Assegnazione giocatore",
  "roster.remove": "Rimozione giocatore",
  "team.create": "Squadra creata",
  "team.update": "Squadra modificata",
  "team.owner": "Manager collegato",
  "team.credits": "Crediti modificati",
  "session.create": "Sessione creata",
  "session.update": "Sessione modificata",
  "session.delete": "Sessione eliminata",
  "session.open": "Sessione aperta",
  "session.close": "Sessione chiusa",
  "market.swap": "Cambio",
  "market.free_swap": "Cambio gratuito",
  "market.reverse": "Annullamento",
  "notification.send": "Email inviata",
};

function summarize(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return Object.entries(payload as Record<string, unknown>)
    .filter(([, v]) => v !== null && typeof v !== "object")
    .slice(0, 5)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

export default async function AdminAuditPage() {
  await requireAdmin();
  const entries = await listAuditLog(300);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Chi ha fatto cosa e quando: registro automatico, solo in lettura."
      />
      <Card>
        <CardHeader>
          <CardTitle>Ultime {entries.length} voci</CardTitle>
          <CardDescription>
            Le operazioni di mercato complete sono nel registro operazioni; qui c&rsquo;è la traccia
            di ogni azione, comprese quelle degli admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-muted text-sm">Ancora nessuna voce.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Quando</TH>
                  <TH>Chi</TH>
                  <TH>Azione</TH>
                  <TH>Dettaglio</TH>
                </TR>
              </THead>
              <TBody>
                {entries.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap">{formatDateTime(e.created_at)}</TD>
                    <TD>{e.display_name ?? (e.user_id ? "Utente rimosso" : "Sistema")}</TD>
                    <TD>
                      <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
                      {e.entity_id && (
                        <span className="text-muted block max-w-40 truncate text-xs">
                          {e.entity} {e.entity_id}
                        </span>
                      )}
                    </TD>
                    <TD className="text-muted max-w-xs text-xs break-words">
                      {summarize(e.payload)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
