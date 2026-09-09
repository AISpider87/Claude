import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { SESSION_STATUS_LABEL as STATUS_LABEL } from "@/lib/market/labels";
import { listSessions } from "@/lib/market/queries";
import { SessionForm } from "./session-form";
import { SessionActions } from "./session-actions";

export const metadata = { title: "Sessioni di mercato" };

export default async function AdminSessionsPage() {
  await requireAdmin();
  const sessions = await listSessions();

  return (
    <>
      <PageHeader
        title="Sessioni di mercato"
        description="Programma le finestre, aprile (foto svincolati + budget extra) e chiudile con il report."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Tutte le sessioni</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="text-muted text-sm">Nessuna sessione: creane una a destra.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Sessione</TH>
                    <TH>Apertura</TH>
                    <TH>Chiusura</TH>
                    <TH>Stato</TH>
                    <TH className="text-right">Azioni</TH>
                  </TR>
                </THead>
                <TBody>
                  {sessions.map((s) => {
                    const st = STATUS_LABEL[s.status] ?? STATUS_LABEL.scheduled;
                    return (
                      <TR key={s.id}>
                        <TD>
                          <Link
                            href={`/admin/sessioni/${s.id}`}
                            className="text-primary font-medium"
                          >
                            {s.name}
                          </Link>
                          <span className="text-muted block text-xs">
                            +{s.extra_budget} crediti
                          </span>
                        </TD>
                        <TD className="whitespace-nowrap">{formatDateTime(s.opens_at)}</TD>
                        <TD className="whitespace-nowrap">{formatDateTime(s.closes_at)}</TD>
                        <TD>
                          <Badge variant={st.variant}>{st.label}</Badge>
                        </TD>
                        <TD className="text-right">
                          <SessionActions session={s} compact />
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nuova sessione</CardTitle>
            <CardDescription>Orari in ora italiana (Europe/Rome).</CardDescription>
          </CardHeader>
          <CardContent>
            <SessionForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
