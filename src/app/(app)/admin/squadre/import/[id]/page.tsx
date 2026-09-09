import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime, formatInt } from "@/lib/format";
import { loadRostersPreview } from "@/lib/import/rosters-loader";
import { resolutionKey } from "@/lib/import/rosters-preview";
import { RostersApplyForm } from "./apply-form";

export const metadata = { title: "Anteprima import rose" };

export default async function RostersImportPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const loaded = await loadRostersPreview(id);
  if (!loaded) notFound();
  const { imp, preview } = loaded;
  const stats = (imp.stats ?? {}) as Record<string, unknown>;

  return (
    <>
      <PageHeader
        title={
          imp.status === "applied"
            ? "Rose importate"
            : imp.status === "failed"
              ? "Import annullato"
              : "Anteprima rose"
        }
        description={`${imp.file_name ?? "—"} · caricato il ${formatDateTime(imp.created_at)}`}
      >
        <Link
          href="/admin/squadre"
          className="text-primary inline-flex min-h-11 items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden /> Squadre
        </Link>
      </PageHeader>

      {imp.status === "failed" && <FormMessage>{imp.error ?? "Import annullato."}</FormMessage>}

      {imp.status === "applied" && (
        <div className="flex flex-col gap-4">
          <FormMessage tone="success">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="size-4" aria-hidden /> Rose aggiornate il{" "}
              {formatDateTime(imp.applied_at)}.
            </span>
          </FormMessage>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Squadre create"
              value={formatInt(stats.teams_created as number)}
              tone="primary"
            />
            <Stat label="Squadre aggiornate" value={formatInt(stats.teams_updated as number)} />
            <Stat label="Giocatori assegnati" value={formatInt(stats.players_assigned as number)} />
            <Stat label="Righe sostituite" value={formatInt(stats.players_released as number)} />
          </div>
        </div>
      )}

      {imp.status === "previewed" && preview && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Squadre nel file" value={formatInt(preview.teams.length)} />
            <Stat label="Nuove squadre" value={formatInt(preview.newTeams)} tone="primary" />
            <Stat label="Giocatori" value={formatInt(preview.totalPlayers)} />
            <Stat
              label="Da risolvere"
              value={formatInt(preview.unresolved)}
              tone={preview.unresolved ? "danger" : "neutral"}
            />
          </div>

          {preview.anomalies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Anomalie nel file</CardTitle>
                <CardDescription>
                  Totali non corrispondenti, costi non numerici o rose di dimensione diversa da 23.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1 text-sm">
                  {preview.anomalies.map((a, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <Badge variant={a.code === "roster_size" ? "muted" : "danger"}>
                        {a.code}
                      </Badge>
                      {a.team && <span className="font-medium">{a.team}</span>}
                      <span className="text-muted">{a.detail}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <RostersApplyForm importId={imp.id} ready={preview.ready} unresolved={preview.unresolved}>
            {preview.teams.map((team) => (
              <Card key={team.name}>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      {team.name}{" "}
                      {team.exists ? (
                        <Badge variant="muted">esistente</Badge>
                      ) : (
                        <Badge variant="primary">nuova</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      speso {formatInt(team.total)} · crediti residui {formatInt(team.credits)}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {(["P", "D", "C", "A"] as const).map((r) => (
                      <span key={r} className="inline-flex items-center gap-1">
                        <RoleBadge role={r} className="size-5 text-[10px]" />
                        <span className="tabular">{team.roleCounts[r]}</span>
                      </span>
                    ))}
                    {team.compositionOk ? (
                      <Badge variant="primary">3/7/7/6 ok</Badge>
                    ) : (
                      <Badge variant="danger">composizione</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Nel file</TH>
                        <TH className="text-right">Costo</TH>
                        <TH>Nel listone</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {team.entries.map((e) => {
                        const key = resolutionKey(team.name, e.row);
                        return (
                          <TR key={key} className={e.player ? undefined : "bg-danger/5"}>
                            <TD className="font-medium">
                              {e.name}
                              {e.outOfList && (
                                <Badge variant="danger" className="ml-2">
                                  *
                                </Badge>
                              )}
                            </TD>
                            <TD className="tabular text-right">{formatInt(e.cost)}</TD>
                            <TD>
                              {e.player && e.status === "matched" ? (
                                <span className="inline-flex items-center gap-2">
                                  <RoleBadge
                                    role={e.player.role_classic}
                                    className="size-5 text-[10px]"
                                  />
                                  {e.player.name}{" "}
                                  <span className="text-muted">· {e.player.team}</span>
                                </span>
                              ) : e.status === "ambiguous" ? (
                                <select
                                  name={`res:${key}`}
                                  defaultValue=""
                                  className="border-line bg-surface min-h-11 w-full rounded-[var(--radius-control)] border px-2 text-sm"
                                  aria-label={`Scegli il calciatore per ${e.name}`}
                                >
                                  <option value="">
                                    — scegli tra {e.candidates.length} omonimi —
                                  </option>
                                  {e.candidates.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name} · {c.role_classic} · {c.team} · Qt.A {c.qt_a}
                                      {c.status === "out_of_list" ? " (fuori lista)" : ""}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="inline-flex flex-wrap items-center gap-2">
                                  <Badge variant="danger">
                                    {e.status === "duplicate" ? "già in rosa" : "non trovato"}
                                  </Badge>
                                  <input
                                    name={`res:${key}`}
                                    type="number"
                                    inputMode="numeric"
                                    placeholder="Id Fantacalcio"
                                    className="border-line bg-surface min-h-11 w-32 rounded-[var(--radius-control)] border px-2 text-sm"
                                    aria-label={`Id Fantacalcio per ${e.name}`}
                                  />
                                </span>
                              )}
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </RostersApplyForm>
        </div>
      )}
    </>
  );
}
