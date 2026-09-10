import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PlayerCard } from "@/components/players/player-card";
import { QuotationChart } from "@/components/players/quotation-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { formatInt } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Calciatore" };

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isInteger(playerId) || playerId <= 0) notFound();

  const supabase = await createClient();
  const { data: player } = await supabase
    .from("players")
    .select("*")
    .eq("id", playerId)
    .maybeSingle();
  if (!player) notFound();

  const [{ data: history }, { data: rosterRows }] = await Promise.all([
    supabase
      .from("player_quotations")
      .select("recorded_at, qt_a, qt_i, fvm")
      .eq("player_id", playerId)
      .order("recorded_at", { ascending: true }),
    supabase
      .from("roster_players")
      .select("team_id, price_paid")
      .eq("player_id", playerId)
      .is("released_at", null),
  ]);
  const teamIds = (rosterRows ?? []).map((r) => r.team_id);
  const { data: teams } = teamIds.length
    ? await supabase.from("teams").select("id, name, short_name").in("id", teamIds)
    : { data: [] as { id: string; name: string; short_name: string }[] };
  const owners = (rosterRows ?? []).map((r) => ({
    ...r,
    team: (teams ?? []).find((t) => t.id === r.team_id),
  }));

  return (
    <>
      <PageHeader title="Scheda calciatore" />
      <PlayerCard
        name={player.name}
        team={player.team}
        role={player.role_classic}
        roleMantra={player.role_mantra}
        qtA={player.qt_a}
        qtI={player.qt_i}
        diff={player.diff}
        fvm={player.fvm}
        availability={
          player.status === "out_of_list" ? "out_of_list" : owners.length === 0 ? "free" : "owned"
        }
        ownersCount={owners.length}
        className="mb-6"
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Andamento quotazione</CardTitle>
            <CardDescription>Una rilevazione per ogni import delle quotazioni.</CardDescription>
          </CardHeader>
          <CardContent>
            <QuotationChart
              points={(history ?? []).map((h) => ({ recordedAt: h.recorded_at, qtA: h.qt_a }))}
              current={player.qt_a}
            />
          </CardContent>
        </Card>

        {(user.role === "admin" || owners.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {user.role === "admin" ? "Chi lo ha in rosa" : "Nella tua rosa"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {owners.length === 0 ? (
                <p className="text-muted text-sm">Nessuna squadra della lega.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {owners.map((o) => (
                    <li key={o.team_id} className="flex items-center justify-between gap-3">
                      <Link href={`/squadre/${o.team_id}`} className="text-primary font-medium">
                        {o.team?.name ?? "—"}
                      </Link>
                      <span className="text-muted tabular">pagato {formatInt(o.price_paid)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Link
          href="/listone"
          className="text-primary inline-flex min-h-11 items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden /> Torna al listone
        </Link>
      </div>
    </>
  );
}
