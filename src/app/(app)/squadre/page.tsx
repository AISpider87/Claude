import Link from "next/link";
import { Users } from "lucide-react";
import { TeamEmblem } from "@/components/roster/team-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { formatInt } from "@/lib/format";
import { listTeams } from "@/lib/teams/queries";

export const metadata = { title: "Squadre" };

export default async function SquadrePage() {
  const user = await requireUser();
  const teams = await listTeams();

  return (
    <>
      <PageHeader
        title="Squadre della lega"
        description={`${teams.length} squadre · le rose sono visibili solo al proprio manager e all'admin`}
      />
      {teams.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nessuna squadra"
          description="L'admin non ha ancora importato le rose."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => {
            const mine = team.owner_id === user.id;
            const canOpen = mine || user.role === "admin";
            const card = (
              <Card className={canOpen ? "hover:border-primary/60 transition-colors" : undefined}>
                <CardContent className="flex items-center gap-3">
                  <TeamEmblem team={team} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      {team.name}
                      {mine && <span className="text-primary ml-2 text-xs">(tu)</span>}
                    </p>
                    <p className="text-muted truncate text-sm">
                      {team.ownerName ?? "manager non collegato"}
                    </p>
                  </div>
                  {team.credits != null && (
                    <div className="text-right text-sm">
                      <p className="tabular font-semibold">{formatInt(team.credits)} cr</p>
                      <p className="text-muted tabular text-xs">
                        {formatInt(team.rosterCount ?? 0)} giocatori
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
            return (
              <li key={team.id}>
                {canOpen ? (
                  <Link href={`/squadre/${team.id}`} className="block">
                    {card}
                  </Link>
                ) : (
                  card
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
