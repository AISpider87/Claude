import Link from "next/link";
import { Users } from "lucide-react";
import {
  RosterPlayerList,
  toPlayerStatus,
  toRosterPlayer,
  type RosterGroup,
} from "@/components/roster/roster-player-row";
import { TeamEmblem, TeamStats } from "@/components/roster/team-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { getMarketSettings } from "@/lib/market/queries";
import { getPlayerStatuses } from "@/lib/players/status";
import { ROLE_ORDER } from "@/lib/roles";
import {
  getMyTeam,
  getRosterComposition,
  getTeamRoster,
  summarizeRoster,
} from "@/lib/teams/queries";

export const metadata = { title: "Rosa" };

export default async function RosaPage() {
  const user = await requireUser();
  const team = await getMyTeam(user.id);

  if (!team) {
    return (
      <>
        <PageHeader title="La tua rosa" description={`Ciao ${user.displayName}.`} />
        <EmptyState
          icon={Users}
          title="Nessuna squadra collegata"
          description="L'admin deve ancora collegare il tuo account alla tua squadra. Intanto puoi guardare le squadre della lega e il listone."
        >
          <Link href="/squadre" className="text-primary min-h-11 text-sm font-medium">
            Vedi le squadre della lega
          </Link>
        </EmptyState>
      </>
    );
  }

  const [roster, composition, settings] = await Promise.all([
    getTeamRoster(team.id),
    getRosterComposition(),
    getMarketSettings(),
  ]);
  const summary = summarizeRoster(roster);
  const availability = await getPlayerStatuses(roster.map((r) => r.player.id));
  const players = roster.map(toRosterPlayer);
  const groups: RosterGroup[] = ROLE_ORDER.map((role) => ({
    role,
    target: composition[role],
    items: players
      .filter((p) => p.role === role)
      .map((player) => ({
        player,
        status: toPlayerStatus(availability.get(player.id), player.outOfList),
      })),
  }));

  return (
    <>
      <PageHeader title={team.name} description={`Manager: ${user.displayName}`}>
        <TeamEmblem team={team} size="lg" />
      </PageHeader>
      <div className="flex flex-col gap-6">
        <TeamStats
          team={team}
          summary={summary}
          composition={composition}
          swapLimit={settings.swapLimit}
        />
        {summary.outOfList > 0 && (
          <FormMessage tone="info">
            {summary.outOfList === 1
              ? "Un calciatore della tua rosa è uscito dalla Serie A: puoi sostituirlo con un cambio gratuito."
              : `${summary.outOfList} calciatori della tua rosa sono usciti dalla Serie A: puoi sostituirli con cambi gratuiti.`}
          </FormMessage>
        )}
        <Card>
          <CardHeader>
            <CardTitle>I tuoi giocatori</CardTitle>
            <CardDescription>
              Quotazione attuale, differenza rispetto al prezzo pagato e disponibilità di ogni
              giocatore. Per svincolare e acquistare vai al{" "}
              <Link href="/mercato" className="text-primary">
                mercato
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RosterPlayerList groups={groups} />
          </CardContent>
        </Card>
        <p className="text-muted text-sm">
          <Link href="/squadre" className="text-primary">
            Vedi le squadre della lega
          </Link>
        </p>
      </div>
    </>
  );
}
