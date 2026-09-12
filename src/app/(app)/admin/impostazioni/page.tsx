import Link from "next/link";
import { Download, History, ScrollText, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getLeagueSettings, listNotifications, listRestorePoints } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/dal";
import { emailProviderLabel, isEmailConfigured } from "@/lib/email/provider";
import { formatDateTime, formatInt } from "@/lib/format";
import { RestorePoints, type RestorePointView } from "./restore-points";
import { LeagueCodeForm, SettingsForm } from "./settings-form";

export const metadata = { title: "Impostazioni" };

const NOTIFICATION_STATUS: Record<
  string,
  { label: string; variant: "primary" | "muted" | "danger" }
> = {
  sent: { label: "Inviata", variant: "primary" },
  partial: { label: "Parziale", variant: "danger" },
  skipped: { label: "Saltata", variant: "muted" },
  failed: { label: "Fallita", variant: "danger" },
};

const EXPORTS = [
  { kind: "rose", label: "Rose e crediti" },
  { kind: "listone", label: "Listone con quotazioni" },
  { kind: "operazioni", label: "Registro operazioni" },
];

export default async function AdminSettingsPage() {
  await requireAdmin();
  const [settings, notifications, restorePoints] = await Promise.all([
    getLeagueSettings(),
    listNotifications(),
    listRestorePoints(),
  ]);
  const points: RestorePointView[] = restorePoints.map((p) => ({
    id: p.id,
    label: p.label,
    takenAt: p.taken_at,
    auto: p.auto,
    teams: p.teams,
    roster: p.roster,
    operationsAfter: p.operations_after,
  }));
  const emailReady = isEmailConfigured();
  const provider = emailProviderLabel();

  return (
    <>
      <PageHeader
        title="Impostazioni lega"
        description="Regole del regolamento come configurazione: cambiale solo se la lega decide così."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Regole</CardTitle>
              <CardDescription>
                Valgono da subito per le operazioni successive; le operazioni già registrate non
                cambiano.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsForm settings={settings} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email inviate</CardTitle>
              <CardDescription>
                {emailReady
                  ? `Provider configurato (${provider}): le email partono all'apertura e alla chiusura delle sessioni e a ogni cambio gratuito.`
                  : "Provider email non configurato (né BREVO_API_KEY né RESEND_API_KEY): le notifiche vengono saltate e registrate qui."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {notifications.length === 0 ? (
                <p className="text-muted text-sm">Nessuna email inviata finora.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Quando</TH>
                      <TH>Oggetto</TH>
                      <TH className="text-right">Destinatari</TH>
                      <TH>Esito</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {notifications.map((n) => {
                      const st = NOTIFICATION_STATUS[n.status] ?? NOTIFICATION_STATUS.skipped!;
                      return (
                        <TR key={n.id}>
                          <TD className="whitespace-nowrap">{formatDateTime(n.created_at)}</TD>
                          <TD>
                            {n.subject}
                            {n.detail && (
                              <span className="text-muted block text-xs">{n.detail}</span>
                            )}
                          </TD>
                          <TD className="tabular text-right">{formatInt(n.recipients)}</TD>
                          <TD>
                            <Badge variant={st.variant}>{st.label}</Badge>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Accesso alla lega</CardTitle>
            </CardHeader>
            <CardContent>
              <LeagueCodeForm code={settings.league_code} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="text-primary size-5" aria-hidden /> Punti di ripristino
              </CardTitle>
              <CardDescription>
                Riporta la lega a uno stato salvato: rose, crediti e cambi tornano come allora e le
                operazioni successive vengono cancellate. Utile dopo una prova.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RestorePoints points={points} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Export Excel</CardTitle>
              <CardDescription>File .xlsx completi, anche come backup.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {EXPORTS.map((x) => (
                <a
                  key={x.kind}
                  href={`/api/admin/export/${x.kind}`}
                  className="border-line hover:border-primary flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm"
                >
                  <Download className="text-primary size-4" aria-hidden /> {x.label}
                </a>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Altro</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Link
                href="/admin/utenti"
                className="text-primary inline-flex min-h-11 items-center gap-2 text-sm"
              >
                <Users className="size-4" aria-hidden /> Utenti e ruoli
              </Link>
              <Link
                href="/admin/audit"
                className="text-primary inline-flex min-h-11 items-center gap-2 text-sm"
              >
                <ScrollText className="size-4" aria-hidden /> Audit log
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
