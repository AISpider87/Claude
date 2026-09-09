import Link from "next/link";
import { CalendarClock, Repeat } from "lucide-react";
import { Countdown } from "@/components/market/countdown";
import { LedgerTable } from "@/components/market/ledger-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { requireUser } from "@/lib/auth/dal";
import { formatDateTime, formatInt } from "@/lib/format";
import { freeSwapPlayer, swapPlayer } from "@/lib/market/actions";
import {
  getCurrentFreeAgents,
  getCurrentSession,
  getMarketSettings,
  getNextScheduledSession,
  getSessionFreeAgents,
  listTransactions,
} from "@/lib/market/queries";
import { getMyTeam, getTeamRoster } from "@/lib/teams/queries";
import { SwapPanel, type RosterOption } from "./swap-panel";

export const metadata = { title: "Mercato" };

export default async function MercatoPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const user = await requireUser();
  const { done } = await searchParams;
  const [team, session, nextSession, settings, ledger] = await Promise.all([
    getMyTeam(user.id),
    getCurrentSession(),
    getNextScheduledSession(),
    getMarketSettings(),
    listTransactions({ limit: 30 }),
  ]);

  const roster = team ? await getTeamRoster(team.id) : [];
  const rosterOptions: RosterOption[] = roster.map((r) => ({
    id: r.player.id,
    name: r.player.name,
    team: r.player.team,
    role: r.player.role_classic,
    qtA: r.player.qt_a,
    pricePaid: r.pricePaid,
    outOfList: r.player.status === "out_of_list",
  }));
  const outOfList = rosterOptions.filter((r) => r.outOfList);
  const [sessionFreeAgents, currentFreeAgents] = await Promise.all([
    session && team ? getSessionFreeAgents(session.id) : Promise.resolve([]),
    outOfList.length > 0 ? getCurrentFreeAgents() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Mercato" description="Sessioni, cambi e bacheca della lega." />
      <div className="flex flex-col gap-6">
        {done === "swap" && <FormMessage tone="success">Cambio registrato.</FormMessage>}
        {done === "free_swap" && (
          <FormMessage tone="success">Cambio gratuito registrato.</FormMessage>
        )}

        {session ? (
          <Card className="border-primary/50">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <Repeat className="text-primary size-5" aria-hidden /> {session.name}
                <span className="text-primary font-display text-sm font-semibold uppercase">
                  aperta
                </span>
              </CardTitle>
              <CardDescription>
                Chiude il {formatDateTime(session.closes_at)} · mancano{" "}
                <Countdown
                  until={session.closes_at}
                  className="text-foreground tabular font-semibold"
                />
              </CardDescription>
            </CardHeader>
            {team && (
              <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Crediti" value={formatInt(team.credits)} tone="primary" />
                <Stat
                  label="Cambi usati"
                  value={`${team.swaps_used}/${settings.swapLimit}`}
                  tone={team.swaps_used >= settings.swapLimit ? "danger" : "neutral"}
                />
                <Stat
                  label="Svincolati"
                  value={formatInt(sessionFreeAgents.length)}
                  className="col-span-2 sm:col-span-1"
                />
              </CardContent>
            )}
          </Card>
        ) : nextSession ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="text-primary size-5" aria-hidden /> {nextSession.name}
              </CardTitle>
              <CardDescription>
                Programmata: apre il {formatDateTime(nextSession.opens_at)} e chiude il{" "}
                {formatDateTime(nextSession.closes_at)}. Il mercato è chiuso fino ad allora.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <EmptyState
            icon={Repeat}
            title="Nessuna sessione in programma"
            description="Quando l'admin aprirà una sessione di mercato potrai fare i tuoi cambi da qui."
          />
        )}

        {!team && (
          <FormMessage tone="info">
            Il tuo account non è ancora collegato a una squadra: chiedi all&apos;admin.
          </FormMessage>
        )}

        {team && session && (
          <Card>
            <CardContent>
              {team.swaps_used >= settings.swapLimit ? (
                <FormMessage tone="info">
                  Hai usato tutti i {settings.swapLimit} cambi della stagione.
                </FormMessage>
              ) : (
                <SwapPanel
                  teamId={team.id}
                  credits={team.credits}
                  roster={rosterOptions.filter((r) => !r.outOfList)}
                  candidates={sessionFreeAgents}
                  refundRule={settings.saleRule}
                  action={swapPlayer}
                  title="Fai un cambio"
                  description={`Vendi un tuo calciatore alla quotazione attuale e prendi uno svincolato dello stesso ruolo. Ti restano ${settings.swapLimit - team.swaps_used} cambi.`}
                  submitLabel="Conferma il cambio"
                />
              )}
            </CardContent>
          </Card>
        )}

        {team && outOfList.length > 0 && (
          <Card className="border-danger/40">
            <CardContent>
              <SwapPanel
                teamId={team.id}
                credits={team.credits}
                roster={outOfList}
                candidates={currentFreeAgents}
                refundRule={settings.freeSwapRule}
                action={freeSwapPlayer}
                title="Cambio gratuito"
                description="Un tuo calciatore è uscito dalla Serie A: puoi sostituirlo in qualsiasi momento, senza consumare cambi. Rientra il prezzo pagato."
                submitLabel="Conferma il cambio gratuito"
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Bacheca mercato</CardTitle>
            <CardDescription>Le ultime operazioni di tutta la lega.</CardDescription>
          </CardHeader>
          <CardContent>
            <LedgerTable rows={ledger} />
            {team && (
              <p className="text-muted mt-3 text-sm">
                <Link href="/rosa" className="text-primary">
                  Vai alla tua rosa
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
