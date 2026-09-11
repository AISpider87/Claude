import { CircleUserRound, LogOut } from "lucide-react";
import { PlayerAvatar } from "@/components/players/player-avatar";
import {
  AVAILABLE_STATUS,
  RosterPlayerList,
  toPlayerStatus,
  toRosterPlayer,
  type PlayerStatus,
  type RosterGroup,
  type RosterPlayer,
} from "@/components/roster/roster-player-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth/dal";
import { CLUB_NAMES, OUT_OF_SERIE_A_TEAM } from "@/lib/avatar/clubs";
import { traitOverrides } from "@/lib/avatar/traits";
import { getPlayerStatuses } from "@/lib/players/status";
import { ROLE_ORDER } from "@/lib/roles";
import type { Team } from "@/lib/supabase/database.types";
import {
  getMyTeam,
  getRosterComposition,
  getTeam,
  getTeamRoster,
  listTeams,
} from "@/lib/teams/queries";

export const metadata = { title: "Anteprima rosa" };

/** Example data: players without a real status (Admin → Indisponibili) get one of these. */
const DEMO_SOURCE = { name: "esempio", url: "https://example.com/indisponibili" };
const DEMO_UPDATED_AT = "2026-09-10T16:30:00Z";

const DEMO_STATUS: Record<"injured" | "doubtful" | "suspended", PlayerStatus> = {
  injured: {
    kind: "injured",
    label: "Infortunato",
    source: DEMO_SOURCE,
    updatedAt: DEMO_UPDATED_AT,
  },
  doubtful: {
    kind: "doubtful",
    label: "In dubbio",
    source: DEMO_SOURCE,
    updatedAt: DEMO_UPDATED_AT,
  },
  suspended: {
    kind: "suspended",
    label: "Squalificato",
    source: DEMO_SOURCE,
    updatedAt: DEMO_UPDATED_AT,
  },
};

/** The admin's own team, otherwise the first team of the league with a roster. */
async function pickTeam(userId: string): Promise<Team | null> {
  const mine = await getMyTeam(userId);
  if (mine) return mine;
  const teams = await listTeams();
  const first = teams.find((t) => (t.rosterCount ?? 0) > 0);
  return first ? getTeam(first.id) : null;
}

function DemoActions({ player }: { player: RosterPlayer }) {
  return (
    <Button variant="ghost" size="sm" disabled aria-label={`Svincola ${player.name} (anteprima)`}>
      <LogOut className="size-3.5" aria-hidden />
      {player.outOfList ? "Svincola gratis" : "Svincola"}
    </Button>
  );
}

export default async function RosterPreviewPage() {
  const user = await requireAdmin();
  const [team, composition] = await Promise.all([pickTeam(user.id), getRosterComposition()]);
  const roster = team ? await getTeamRoster(team.id) : [];
  const [realStatuses, curated] = [
    await getPlayerStatuses(roster.map((r) => r.player.id)),
    traitOverrides(),
  ];

  const players: RosterPlayer[] = roster.map(toRosterPlayer);

  // Real statuses first; demo ones (2 injured, 1 doubtful, 1 suspended) fill
  // the outfield players that have none, so the admin sees every chip.
  const outfield = players.filter((p) => p.role !== "P" && !p.outOfList && !realStatuses.has(p.id));
  const demoStatus = new Map<number, PlayerStatus>();
  if (outfield[1]) demoStatus.set(outfield[1].id, DEMO_STATUS.injured);
  if (outfield[7]) demoStatus.set(outfield[7].id, DEMO_STATUS.injured);
  if (outfield[4]) demoStatus.set(outfield[4].id, DEMO_STATUS.doubtful);
  if (outfield[11]) demoStatus.set(outfield[11].id, DEMO_STATUS.suspended);
  const statusFor = (player: RosterPlayer): PlayerStatus | undefined => {
    const real = toPlayerStatus(realStatuses.get(player.id), player.outOfList);
    if (real !== AVAILABLE_STATUS) return real;
    return demoStatus.get(player.id) ?? AVAILABLE_STATUS;
  };

  const groups: RosterGroup[] = ROLE_ORDER.map((role) => ({
    role,
    target: composition[role],
    items: players
      .filter((p) => p.role === role)
      .map((player) => ({
        player,
        status: statusFor(player),
        actions: <DemoActions player={player} />,
      })),
  }));

  const detailSample = [...players]
    .filter((p) => !p.outOfList)
    .sort((a, b) => b.qtA - a.qtA)
    .slice(0, 6);

  return (
    <>
      <PageHeader
        title="Anteprima rosa"
        description="Riferimento grafico approvato: la riga giocatore con avatar a mezzo busto, ruolo, club, quotazione e stato è in uso nelle pagine Rosa e Mercato."
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{team ? `Rosa di ${team.name}` : "Rosa"}</CardTitle>
            <CardDescription>
              {team
                ? "Questo design è attivo in Rosa (sola lettura) e in Mercato (svincoli e acquisti); nel listone restano le sole iniziali."
                : "Nessuna squadra con una rosa importata."}{" "}
              <span className="text-foreground font-medium">
                Stati di esempio (fonte &ldquo;esempio&rdquo;) solo qui: nell&rsquo;app compaiono
                gli stati segnati in Admin → Indisponibili.
              </span>{" "}
              I pulsanti &ldquo;Svincola&rdquo; sono disattivati: mostrano dove stanno le
              operazioni.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {players.length === 0 ? (
              <EmptyState
                icon={CircleUserRound}
                title="Nessuna rosa da mostrare"
                description="Importa le rose delle squadre per vedere l'anteprima con giocatori reali."
              />
            ) : (
              <RosterPlayerList groups={groups} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Maglie dei 20 club</CardTitle>
            <CardDescription>
              Stesso volto, solo i colori di casa: nessuno stemma, nessun logo. L&rsquo;ultimo è il
              segnaposto per chi ha lasciato la Serie A (maglia grigia tratteggiata e segno rosso).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-7">
              {CLUB_NAMES.map((club) => (
                <li key={club} className="flex flex-col items-center gap-1 text-center">
                  <PlayerAvatar id={0} name="Maglia" team={club} role="C" showRole={false} />
                  <p className="w-full truncate text-xs">{club}</p>
                </li>
              ))}
              <li className="flex flex-col items-center gap-1 text-center">
                <PlayerAvatar
                  id={-1}
                  name="Giocatore ceduto"
                  team={OUT_OF_SERIE_A_TEAM}
                  role="A"
                  outOfList
                  showRole={false}
                />
                <Badge variant="danger">fuori lista</Badge>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dettaglio a 120 px</CardTitle>
            <CardDescription>
              I sei giocatori con la Qt.A più alta della rosa. I tratti sono generati dall&rsquo;id;
              per {Object.keys(curated).length} giocatori noti c&rsquo;è una correzione manuale
              approssimativa (puntino accanto al nome).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detailSample.length === 0 ? (
              <p className="text-muted text-sm">Nessun giocatore da mostrare.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {detailSample.map((p) => (
                  <li key={p.id} className="flex flex-col items-center gap-1 text-center">
                    <PlayerAvatar id={p.id} name={p.name} team={p.team} role={p.role} size="xl" />
                    <p className="w-full truncate text-sm font-medium">
                      {p.name}
                      {curated[String(p.id)] && (
                        <span
                          className="bg-primary ml-1 inline-block size-1.5 rounded-full align-middle"
                          title="Tratti curati (approssimativi)"
                          aria-label="tratti curati, approssimativi"
                        />
                      )}
                    </p>
                    <p className="text-muted w-full truncate text-xs">{p.team}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
