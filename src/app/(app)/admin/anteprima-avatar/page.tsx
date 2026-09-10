import { CircleUserRound } from "lucide-react";
import { PlayerAvatar } from "@/components/players/player-avatar";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth/dal";
import { CLUB_NAMES, OUT_OF_SERIE_A_TEAM } from "@/lib/avatar/clubs";
import { traitOverrides } from "@/lib/avatar/traits";
import { formatInt } from "@/lib/format";
import type { RoleClassic } from "@/lib/import/quotations-parser";
import { ROLE_LABEL, ROLE_LABEL_SINGULAR, ROLE_ORDER } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Anteprima avatar" };

const PER_ROLE = 6;

interface PreviewPlayer {
  id: number;
  name: string;
  team: string;
  role: RoleClassic;
  qtA: number;
}

/** Top players per role, spread across different clubs, highest Qt.A first. */
async function loadPreviewPlayers(): Promise<PreviewPlayer[]> {
  const supabase = await createClient();
  const perRole = await Promise.all(
    ROLE_ORDER.map((role) =>
      supabase
        .from("players")
        .select("id, name, team, role_classic, qt_a")
        .eq("status", "active")
        .eq("role_classic", role)
        .gt("id", 0)
        .order("qt_a", { ascending: false })
        .order("id")
        .limit(80),
    ),
  );

  const picked: PreviewPlayer[] = [];
  for (const { data } of perRole) {
    const rows = data ?? [];
    const seenTeams = new Set<string>();
    const chosen = rows.filter((r) => {
      if (seenTeams.size >= PER_ROLE || seenTeams.has(r.team)) return false;
      seenTeams.add(r.team);
      return true;
    });
    for (const r of rows) {
      if (chosen.length >= PER_ROLE) break;
      if (!chosen.includes(r)) chosen.push(r);
    }
    picked.push(
      ...chosen.map((r) => ({
        id: r.id,
        name: r.name,
        team: r.team,
        role: r.role_classic,
        qtA: r.qt_a,
      })),
    );
  }
  return picked;
}

export default async function AvatarPreviewPage() {
  await requireAdmin();
  const players = await loadPreviewPlayers();
  const curated = traitOverrides();

  return (
    <>
      <PageHeader
        title="Anteprima avatar"
        description="Avatar generati in SVG, senza foto né loghi: da approvare prima di usarli nelle pagine."
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Giocatori dal listone</CardTitle>
            <CardDescription>
              {PER_ROLE} per ruolo, club diversi, ordinati per Qt.A. I tratti sono generati
              dall&rsquo;id; per {Object.keys(curated).length} giocatori noti c&rsquo;è una
              correzione manuale approssimativa (segnata con il puntino).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {players.length === 0 ? (
              <EmptyState
                icon={CircleUserRound}
                title="Listone non ancora importato"
                description="Importa le quotazioni per vedere gli avatar dei giocatori reali."
              />
            ) : (
              <div className="flex flex-col gap-6">
                {ROLE_ORDER.map((role) => {
                  const group = players.filter((p) => p.role === role);
                  if (group.length === 0) return null;
                  return (
                    <section key={role} aria-labelledby={`avatar-role-${role}`}>
                      <h3
                        id={`avatar-role-${role}`}
                        className="font-display mb-3 flex items-center gap-2 text-sm font-semibold"
                      >
                        <RoleBadge role={role} />
                        {ROLE_LABEL[role]}
                      </h3>
                      <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                        {group.map((p) => (
                          <li key={p.id} className="flex flex-col items-center gap-1 text-center">
                            <PlayerAvatar
                              id={p.id}
                              name={p.name}
                              team={p.team}
                              role={p.role}
                              size="lg"
                            />
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
                            <p className="text-muted w-full truncate text-xs">
                              {p.team} · {ROLE_LABEL_SINGULAR[p.role]}
                            </p>
                            <p className="text-muted tabular text-xs">Qt.A {formatInt(p.qtA)}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Maglie dei 20 club</CardTitle>
            <CardDescription>
              Stesso volto generico, solo i colori di casa: nessuno stemma, nessun logo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-4 gap-3 sm:grid-cols-5 lg:grid-cols-10">
              {CLUB_NAMES.map((club) => (
                <li key={club} className="flex flex-col items-center gap-1 text-center">
                  <PlayerAvatar id={0} name="Maglia" team={club} role="C" showRole={false} />
                  <p className="w-full truncate text-xs">{club}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Segnaposto e dimensioni</CardTitle>
            <CardDescription>
              Chi ha lasciato la Serie A ha la maglia grigia tratteggiata e il segno rosso
              nell&rsquo;angolo. Le quattro taglie: 32, 48, 72 e 120 px.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <PlayerAvatar
                id={-1}
                name="Giocatore ceduto"
                team={OUT_OF_SERIE_A_TEAM}
                role="A"
                outOfList
                size="lg"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">Giocatore ceduto</p>
                <p className="text-muted text-xs">{OUT_OF_SERIE_A_TEAM} · Attaccante</p>
                <Badge variant="danger" className="mt-1">
                  fuori lista
                </Badge>
              </div>
            </div>
            <ul className="flex flex-wrap items-end gap-6">
              {(["sm", "md", "lg", "xl"] as const).map((size) => (
                <li key={size} className="flex flex-col items-center gap-1">
                  <PlayerAvatar id={309} name="Dybala" team="Roma" role="A" size={size} />
                  <p className="text-muted tabular text-xs">{size}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
