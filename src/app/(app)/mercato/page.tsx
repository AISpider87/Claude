import Link from "next/link";
import { CalendarClock, Repeat } from "lucide-react";
import { Countdown } from "@/components/market/countdown";
import { LedgerTable } from "@/components/market/ledger-table";
import { SwapDone } from "@/components/market/swap-done";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { requireUser } from "@/lib/auth/dal";
import { formatDateTime, formatInt } from "@/lib/format";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import { buyPlayer, releaseOutOfList, sellPlayer } from "@/lib/market/actions";
import {
  getCurrentFreeAgents,
  getCurrentSession,
  getMarketSettings,
  getNextScheduledSession,
  getSessionFreeAgents,
  getTeamMarketState,
  listTransactions,
  type FreeAgentOption,
} from "@/lib/market/queries";
import { ROLE_ORDER } from "@/lib/roles";
import { getMyTeam, getRosterComposition, getTeamRoster } from "@/lib/teams/queries";
import { BuyPanel, type BuyCandidate } from "./buy-panel";
import { MarketRoster, type RosterOption } from "./market-roster";

const DONE_MESSAGE: Record<string, string> = {
  sell: "Svincolo registrato: i crediti sono tornati nel tuo budget.",
  buy: "Acquisto registrato: la tua rosa è aggiornata.",
  free_release: "Svincolo gratuito registrato.",
};

export const metadata = { title: "Mercato" };

export default async function MercatoPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const user = await requireUser();
  const { done } = await searchParams;
  const [team, session, nextSession, settings, composition, ledger] = await Promise.all([
    getMyTeam(user.id),
    getCurrentSession(),
    getNextScheduledSession(),
    getMarketSettings(),
    getRosterComposition(),
    listTransactions({ limit: 30 }),
  ]);

  const [roster, state] = team
    ? await Promise.all([getTeamRoster(team.id), getTeamMarketState(team.id)])
    : [[], null];
  const rosterOptions: RosterOption[] = roster.map((r) => ({
    id: r.player.id,
    name: r.player.name,
    team: r.player.team,
    role: r.player.role_classic,
    qtA: r.player.qt_a,
    pricePaid: r.pricePaid,
    outOfList: r.player.status === "out_of_list",
  }));
  const slots = state?.slots ?? { P: 0, D: 0, C: 0, A: 0 };
  const freeSlots = state?.freeSlots ?? { P: 0, D: 0, C: 0, A: 0 };
  // Roles the team can buy for: a free slot (any time, current free agents) or a
  // hole to fill during the open session (from the session snapshot).
  const freeRoles = ROLE_ORDER.filter((r) => freeSlots[r] > 0 && slots[r] > 0);
  const sessionRoles = session
    ? ROLE_ORDER.filter((r) => slots[r] > 0 && !freeRoles.includes(r))
    : [];
  const openRoles: RoleClassic[] = ROLE_ORDER.filter(
    (r) => freeRoles.includes(r) || sessionRoles.includes(r),
  );
  const [sessionFreeAgents, currentFreeAgents] = await Promise.all([
    session && sessionRoles.length > 0 ? getSessionFreeAgents(session.id) : Promise.resolve([]),
    freeRoles.length > 0 ? getCurrentFreeAgents() : Promise.resolve([]),
  ]);
  const owned = new Set(rosterOptions.map((r) => r.id));
  const toCandidate = (p: FreeAgentOption, free: boolean): BuyCandidate => ({ ...p, free });
  const candidates: BuyCandidate[] = [
    ...currentFreeAgents.filter((p) => freeRoles.includes(p.role)).map((p) => toCandidate(p, true)),
    ...sessionFreeAgents
      .filter((p) => sessionRoles.includes(p.role))
      .map((p) => toCandidate(p, false)),
  ].filter((p) => !owned.has(p.id));
  const holes = ROLE_ORDER.reduce((n, r) => n + Math.max(0, slots[r]), 0);
  const limitReached = team ? team.swaps_used >= settings.swapLimit : false;

  return (
    <>
      <PageHeader title="Mercato" description="Sessioni, cambi e bacheca della lega." />
      <div className="flex flex-col gap-6">
        {done && DONE_MESSAGE[done] && <SwapDone message={DONE_MESSAGE[done]} />}

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
                  label="Posti da riempire"
                  value={formatInt(holes)}
                  tone={holes > 0 ? "danger" : "neutral"}
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
                Programmata: si apre da sola il {formatDateTime(nextSession.opens_at)} e chiude il{" "}
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

        {team && (
          <Card>
            <CardHeader>
              <CardTitle>La tua rosa</CardTitle>
              <CardDescription>
                {session
                  ? `Svincola chi vuoi cedere: incassi la quotazione attuale. Poi prendi uno svincolato dello stesso ruolo. Ti restano ${Math.max(0, settings.swapLimit - team.swaps_used)} cambi (ogni acquisto ne usa uno).`
                  : "Fuori sessione puoi solo svincolare gratis chi è uscito dalla Serie A e prendere il suo sostituto."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MarketRoster
                teamId={team.id}
                credits={team.credits}
                roster={rosterOptions}
                composition={composition}
                slots={slots}
                sessionOpen={Boolean(session)}
                refundRule={settings.saleRule}
                sellAction={sellPlayer}
                releaseAction={releaseOutOfList}
              />
            </CardContent>
          </Card>
        )}

        {team && holes > 0 && (
          <Card className="border-primary/50">
            <CardHeader>
              <CardTitle>Acquista</CardTitle>
              <CardDescription>
                {openRoles.length > 0
                  ? "Solo svincolati dei ruoli in cui hai un posto libero: chi esce difensore rientra difensore."
                  : session
                    ? "Nessuno svincolato disponibile per i ruoli scoperti."
                    : "Il mercato è chiuso: potrai riempire i posti liberi alla prossima sessione."}
              </CardDescription>
            </CardHeader>
            {openRoles.length > 0 && (
              <CardContent>
                {limitReached && sessionRoles.length > 0 && freeRoles.length === 0 ? (
                  <FormMessage tone="info">
                    Hai usato tutti i {settings.swapLimit} cambi della stagione.
                  </FormMessage>
                ) : (
                  <BuyPanel
                    teamId={team.id}
                    credits={team.credits}
                    candidates={candidates}
                    openRoles={openRoles}
                    action={buyPlayer}
                  />
                )}
              </CardContent>
            )}
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{user.role === "admin" ? "Bacheca mercato" : "Le tue operazioni"}</CardTitle>
            <CardDescription>
              {user.role === "admin"
                ? "Le ultime operazioni di tutta la lega."
                : "Le tue ultime operazioni: le rose e i mercati degli altri sono privati."}
            </CardDescription>
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
