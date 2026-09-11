import Link from "next/link";
import { CalendarClock, Repeat } from "lucide-react";
import { Countdown } from "@/components/market/countdown";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { LedgerTable } from "@/components/market/ledger-table";
import { SwapDone } from "@/components/market/swap-done";
import {
  toPlayerStatus,
  toRosterPlayer,
  type PlayerStatus,
} from "@/components/roster/roster-player-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { getPlayerLineups } from "@/lib/availability/queries";
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
  listPendingOperations,
  listTransactions,
  type FreeAgentOption,
} from "@/lib/market/queries";
import { getPlayerStatuses } from "@/lib/players/status";
import { ROLE_LABEL_SINGULAR, ROLE_ORDER } from "@/lib/roles";
import { getMyTeam, getRosterComposition, getTeamRoster } from "@/lib/teams/queries";
import { BuyPanel, type BuyCandidate } from "./buy-panel";
import { MarketRoster, type RosterOption } from "./market-roster";
import { PendingOperations, type PendingRow } from "./pending-operations";

const DONE_MESSAGE: Record<string, string> = {
  sell: "Svincolo registrato: i crediti sono tornati nel tuo budget.",
  buy: "Acquisto registrato: la tua rosa è aggiornata.",
  free_release: "Svincolo gratuito registrato.",
  undo: "Operazione annullata: rosa e crediti sono tornati come prima.",
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
  const rosterOptions: RosterOption[] = roster.map(toRosterPlayer);
  // Availability chips (Admin → Indisponibili) as a plain object: the roster is a client component.
  const rosterIds = rosterOptions.map((r) => r.id);
  const [availability, lineups] = await Promise.all([
    getPlayerStatuses(rosterIds),
    getPlayerLineups(rosterIds),
  ]);
  const statuses: Record<number, PlayerStatus> = {};
  for (const r of rosterOptions) {
    const status = toPlayerStatus(availability.get(r.id), r.outOfList, lineups.get(r.id));
    if (status) statuses[r.id] = status;
  }
  const slots = state?.slots ?? { P: 0, D: 0, C: 0, A: 0 };
  const freeSlots = state?.freeSlots ?? { P: 0, D: 0, C: 0, A: 0 };
  const pendingSwaps = state?.pending.swaps ?? 0;
  const limitReached = team ? team.swaps_used + pendingSwaps >= settings.swapLimit : false;
  // Roles the team can buy for: a free slot (any time, current free agents) or a
  // hole to fill during the open session (from the session snapshot).
  const freeRoles = ROLE_ORDER.filter((r) => freeSlots[r] > 0 && slots[r] > 0);
  const sessionRoles = session
    ? ROLE_ORDER.filter((r) => slots[r] > 0 && !freeRoles.includes(r))
    : [];
  const openRoles: RoleClassic[] = ROLE_ORDER.filter(
    (r) => freeRoles.includes(r) || sessionRoles.includes(r),
  );
  // The whole free-agent list is shown (every role); players the team cannot buy
  // right now are disabled with the reason, so nobody wonders where they went.
  const [sessionFreeAgents, currentFreeAgents, pendingRows] = await Promise.all([
    session && team ? getSessionFreeAgents(session.id) : Promise.resolve([]),
    freeRoles.length > 0 ? getCurrentFreeAgents() : Promise.resolve([]),
    session && team ? listPendingOperations(team.id) : Promise.resolve([]),
  ]);
  const owned = new Set(rosterOptions.map((r) => r.id));
  const blockedReason = (role: RoleClassic): string | undefined => {
    if (freeRoles.includes(role)) return undefined;
    if (slots[role] <= 0)
      return `nessun posto libero: svincola prima un ${ROLE_LABEL_SINGULAR[role]}`;
    if (!session) return "il mercato è chiuso";
    if (limitReached) return "hai finito i cambi della stagione";
    return undefined;
  };
  const toCandidate = (p: FreeAgentOption, free: boolean): BuyCandidate => ({
    ...p,
    free,
    blocked: free ? undefined : blockedReason(p.role),
  });
  const freeIds = new Set(
    currentFreeAgents.filter((p) => freeRoles.includes(p.role)).map((p) => p.id),
  );
  const candidates: BuyCandidate[] = [
    ...currentFreeAgents.filter((p) => freeIds.has(p.id)).map((p) => toCandidate(p, true)),
    ...sessionFreeAgents.filter((p) => !freeIds.has(p.id)).map((p) => toCandidate(p, false)),
  ].filter((p) => !owned.has(p.id));
  const holes = ROLE_ORDER.reduce((n, r) => n + Math.max(0, slots[r]), 0);
  const pending: PendingRow[] = pendingRows.map((t) => ({
    id: t.id,
    kind: t.kind,
    label: t.kind === "buy" ? `entra ${t.playerInName ?? "—"}` : `esce ${t.playerOutName ?? "—"}`,
    counts: t.counts_toward_limit,
    creditsDelta: t.credits_delta,
  }));

  return (
    <>
      <PageHeader title="Mercato" description="Sessioni, cambi e bacheca della lega." />
      <div className="flex flex-col gap-6">
        {done && Object.hasOwn(DONE_MESSAGE, done) && <SwapDone message={DONE_MESSAGE[done]!} />}

        {session ? (
          <Card className="edge-live border-primary/50">
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
                <Stat
                  label="Crediti"
                  value={<AnimatedNumber value={team.credits} />}
                  tone="primary"
                />
                <Stat
                  label="Cambi usati"
                  value={
                    pendingSwaps > 0
                      ? `${team.swaps_used}/${settings.swapLimit} (+${pendingSwaps})`
                      : `${team.swaps_used}/${settings.swapLimit}`
                  }
                  tone={limitReached ? "danger" : "neutral"}
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
          <section
            aria-label="Console di mercato"
            className="grid items-start gap-4 lg:grid-cols-2"
          >
            <Card className="order-1 lg:order-2">
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
                  statuses={statuses}
                  composition={composition}
                  slots={slots}
                  sessionOpen={Boolean(session)}
                  refundRule={settings.saleRule}
                  sellAction={sellPlayer}
                  releaseAction={releaseOutOfList}
                />
              </CardContent>
            </Card>

            {session && pending.length > 0 && (
              <Card className="border-role-p/40 order-2 self-start lg:order-1 lg:col-span-2">
                <CardHeader className="pb-0">
                  <CardTitle className="text-base">Operazioni di questa sessione</CardTitle>
                  <CardDescription>
                    Finché la sessione è aperta puoi annullarle. Alla chiusura diventano definitive
                    e ogni acquisto conta un cambio.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-3">
                  <PendingOperations rows={pending} />
                </CardContent>
              </Card>
            )}

            {(holes > 0 || (session && candidates.length > 0)) && (
              <Card className="border-primary/50 order-3">
                <CardHeader>
                  <CardTitle>Acquista</CardTitle>
                  <CardDescription>
                    {session
                      ? "Tutti gli svincolati della sessione. Puoi prendere solo chi copre un posto libero: chi esce difensore rientra difensore."
                      : openRoles.length > 0
                        ? "Sostituti dei fuori lista, tra gli svincolati liberi adesso."
                        : "Il mercato è chiuso: potrai riempire i posti liberi alla prossima sessione."}
                  </CardDescription>
                </CardHeader>
                {candidates.length > 0 && (
                  <CardContent>
                    {limitReached && freeRoles.length === 0 ? (
                      <FormMessage tone="info">
                        Hai usato tutti i {settings.swapLimit} cambi della stagione
                        {pendingSwaps > 0 ? " (compresi quelli in sospeso)" : ""}.
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
          </section>
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
