import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LedgerTable } from "@/components/market/ledger-table";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime, formatInt } from "@/lib/format";
import { getSession, listTransactions } from "@/lib/market/queries";
import { createClient } from "@/lib/supabase/server";
import { utcToZonedLocal } from "@/lib/time";
import { SessionActions } from "../session-actions";
import { SessionForm } from "../session-form";
import { SESSION_STATUS_LABEL as STATUS_LABEL } from "@/lib/market/labels";

export const metadata = { title: "Sessione" };

interface ReportTeam {
  team_id: string;
  team: string;
  credits: number;
  swaps_used: number;
  count: number;
  by_role: Record<string, number>;
  out_of_list: number;
  ok: boolean;
}

export default async function AdminSessionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();

  const supabase = await createClient();
  const [ledger, { count: freeCount }] = await Promise.all([
    listTransactions({ sessionId: session.id, limit: 200 }),
    supabase
      .from("session_free_agents")
      .select("player_id", { count: "exact", head: true })
      .eq("session_id", session.id),
  ]);
  const report = (session.validation_report ?? null) as {
    teams?: ReportTeam[];
    invalid?: number;
  } | null;
  const st = STATUS_LABEL[session.status] ?? STATUS_LABEL.scheduled;

  return (
    <>
      <PageHeader title={session.name} description={`Stato: ${st.label}`}>
        <Link
          href="/admin/sessioni"
          className="text-primary inline-flex min-h-11 items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden /> Sessioni
        </Link>
      </PageHeader>

      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Apertura"
            value={<span className="text-base">{formatDateTime(session.opens_at)}</span>}
          />
          <Stat
            label="Chiusura"
            value={<span className="text-base">{formatDateTime(session.closes_at)}</span>}
          />
          <Stat label="Svincolati (foto)" value={formatInt(freeCount ?? 0)} />
          <Stat label="Operazioni" value={formatInt(ledger.length)} tone="primary" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dati sessione</CardTitle>
              <CardDescription>
                Orari in ora italiana. A sessione aperta si possono solo spostare le date.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SessionForm
                session={session}
                opensLocal={utcToZonedLocal(session.opens_at)}
                closesLocal={utcToZonedLocal(session.closes_at)}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stato</CardTitle>
              <CardDescription>
                Aprire fotografa gli svincolati e accredita +{session.extra_budget} a ogni squadra;
                chiudere produce il report di validazione delle rose.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SessionActions session={session} />
            </CardContent>
          </Card>
        </div>

        {report?.teams && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Report di chiusura{" "}
                {report.invalid ? (
                  <Badge variant="danger">{report.invalid} rose da sistemare</Badge>
                ) : (
                  <Badge variant="primary">tutte le rose sono regolari</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Composizione 3/7/7/6, nessun fuori lista, crediti ≥ 0.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <TR>
                    <TH>Squadra</TH>
                    <TH className="text-right">Giocatori</TH>
                    <TH>Per ruolo</TH>
                    <TH className="text-right">Fuori lista</TH>
                    <TH className="text-right">Crediti</TH>
                    <TH>Esito</TH>
                  </TR>
                </THead>
                <TBody>
                  {report.teams.map((t) => (
                    <TR key={t.team_id}>
                      <TD className="font-medium">
                        <Link href={`/admin/squadre/${t.team_id}`} className="text-primary">
                          {t.team}
                        </Link>
                      </TD>
                      <TD className="tabular text-right">{t.count}</TD>
                      <TD>
                        <span className="inline-flex items-center gap-2">
                          {(["P", "D", "C", "A"] as const).map((r) => (
                            <span key={r} className="inline-flex items-center gap-1">
                              <RoleBadge role={r} className="size-5 text-[10px]" />
                              <span className="tabular text-xs">{t.by_role?.[r] ?? 0}</span>
                            </span>
                          ))}
                        </span>
                      </TD>
                      <TD className="tabular text-right">{t.out_of_list}</TD>
                      <TD className="tabular text-right">{formatInt(t.credits)}</TD>
                      <TD>
                        {t.ok ? (
                          <Badge variant="primary">ok</Badge>
                        ) : (
                          <Badge variant="danger">da sistemare</Badge>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Operazioni della sessione</CardTitle>
          </CardHeader>
          <CardContent>
            <LedgerTable rows={ledger} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
