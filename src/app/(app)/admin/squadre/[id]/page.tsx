import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RosterTable } from "@/components/roster/roster-table";
import { TeamEmblem, TeamStats } from "@/components/roster/team-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth/dal";
import { getMarketSettings } from "@/lib/market/queries";
import { createClient } from "@/lib/supabase/server";
import {
  getAllPlayers,
  getRosterComposition,
  getTeam,
  getTeamRoster,
  summarizeRoster,
} from "@/lib/teams/queries";
import { TeamForm } from "../team-form";
import { AssignPlayerForm, CreditsForm, OwnerForm, RemovePlayerButton } from "./manage-forms";

export const metadata = { title: "Gestione squadra" };

export default async function AdminTeamPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();

  const supabase = await createClient();
  const [roster, composition, settings, players, { data: profiles }] = await Promise.all([
    getTeamRoster(team.id),
    getRosterComposition(),
    getMarketSettings(),
    getAllPlayers(),
    supabase
      .from("profiles")
      .select("user_id, display_name, role, is_active")
      .order("display_name"),
  ]);
  const summary = summarizeRoster(roster);
  const inRoster = new Set(roster.map((r) => r.player.id));
  const pickable = players
    .filter((p) => p.status === "active" && !inRoster.has(p.id))
    .map((p) => ({
      id: p.id,
      label: `${p.name} (${p.role_classic} · ${p.team} · ${p.qt_a})`,
      qtA: p.qt_a,
    }));

  return (
    <>
      <PageHeader title={team.name} description="Gestione admin">
        <TeamEmblem team={team} size="lg" />
      </PageHeader>

      <div className="flex flex-col gap-6">
        <TeamStats
          team={team}
          summary={summary}
          composition={composition}
          swapLimit={settings.swapLimit}
        />

        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dati squadra</CardTitle>
            </CardHeader>
            <CardContent>
              <TeamForm team={team} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manager</CardTitle>
              <CardDescription>
                L&apos;utente che gestisce questa squadra (uno per squadra).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OwnerForm
                teamId={team.id}
                ownerId={team.owner_id}
                users={(profiles ?? []).filter((p) => p.is_active)}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Crediti</CardTitle>
              <CardDescription>
                Correzione manuale, registrata nel registro operazioni.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreditsForm teamId={team.id} credits={team.credits} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aggiungi un calciatore</CardTitle>
            <CardDescription>
              Assegnazione manuale (correzioni o rosa iniziale). Il prezzo viene scalato dai
              crediti.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssignPlayerForm teamId={team.id} players={pickable} />
          </CardContent>
        </Card>

        <RosterTable
          roster={roster}
          composition={composition}
          actions={(row) => (
            <RemovePlayerButton
              teamId={team.id}
              playerId={row.player.id}
              defaultRefund={row.pricePaid}
              name={row.player.name}
            />
          )}
        />

        <Link
          href="/admin/squadre"
          className="text-primary inline-flex min-h-11 items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden /> Tutte le squadre
        </Link>
      </div>
    </>
  );
}
