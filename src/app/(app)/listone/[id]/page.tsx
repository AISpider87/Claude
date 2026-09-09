import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { QuotationChart } from "@/components/players/quotation-chart";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { requireUser } from "@/lib/auth/dal";
import { formatDate, formatDelta, formatInt } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Calciatore" };

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
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
      <PageHeader
        title={player.name}
        description={`${player.team}${player.role_mantra ? ` · Mantra ${player.role_mantra}` : ""}`}
      >
        <span className="inline-flex items-center gap-2">
          <RoleBadge role={player.role_classic} className="size-9 text-base" />
          {player.status === "out_of_list" ? (
            <Badge variant="danger">fuori lista dal {formatDate(player.out_of_list_at)}</Badge>
          ) : owners.length === 0 ? (
            <Badge variant="primary">svincolato</Badge>
          ) : (
            <Badge variant="muted">
              in {owners.length} {owners.length === 1 ? "rosa" : "rose"}
            </Badge>
          )}
        </span>
      </PageHeader>

      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Qt.A" value={formatInt(player.qt_a)} tone="primary" />
          <Stat label="Qt.I" value={formatInt(player.qt_i)} />
          <Stat
            label="Diff."
            value={formatDelta(player.diff)}
            tone={player.diff < 0 ? "danger" : "neutral"}
          />
          <Stat label="FVM" value={formatInt(player.fvm)} />
        </div>

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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Chi lo ha in rosa</CardTitle>
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
