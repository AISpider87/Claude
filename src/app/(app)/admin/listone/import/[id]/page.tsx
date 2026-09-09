import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime, formatDelta, formatInt } from "@/lib/format";
import type { Anomaly } from "@/lib/import/quotations-parser";
import type {
  NotableChange,
  PreviewPlayer,
  QuotationsPreview,
} from "@/lib/import/quotations-preview";
import { createClient } from "@/lib/supabase/server";
import { ApplyControls } from "./apply-controls";

export const metadata = { title: "Anteprima import" };

interface ImportStats {
  preview?: QuotationsPreview;
  anomalies?: Anomaly[];
  anomaly_count?: number;
  storage_error?: string | null;
  rows?: number;
  new?: number;
  updated?: number;
  unchanged?: number;
  revived?: number;
  out_of_list?: number;
  notable_changes?: { id: number; name: string; from: number; to: number }[];
}

function PlayerList({ title, players }: { title: string; players: PreviewPlayer[] }) {
  if (!players.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <THead>
            <TR>
              <TH>R</TH>
              <TH>Nome</TH>
              <TH>Squadra</TH>
              <TH className="text-right">Qt.A</TH>
            </TR>
          </THead>
          <TBody>
            {players.map((p) => (
              <TR key={p.id}>
                <TD>
                  <RoleBadge role={p.role_classic} />
                </TD>
                <TD className="font-medium">{p.name}</TD>
                <TD className="text-muted">{p.team}</TD>
                <TD className="tabular text-right">{formatInt(p.qt_a)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ChangesList({ changes, threshold }: { changes: NotableChange[]; threshold: number }) {
  if (!changes.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Variazioni di quotazione rilevanti</CardTitle>
        <CardDescription>
          Differenze di almeno {threshold} crediti rispetto al listone attuale.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <THead>
            <TR>
              <TH>R</TH>
              <TH>Nome</TH>
              <TH className="text-right">Prima</TH>
              <TH className="text-right">Dopo</TH>
              <TH className="text-right">Δ</TH>
            </TR>
          </THead>
          <TBody>
            {changes.map((c) => (
              <TR key={c.id}>
                <TD>
                  <RoleBadge role={c.role_classic} />
                </TD>
                <TD className="font-medium">
                  {c.name} <span className="text-muted">· {c.team}</span>
                </TD>
                <TD className="tabular text-right">{formatInt(c.from)}</TD>
                <TD className="tabular text-right">{formatInt(c.to)}</TD>
                <TD
                  className={`tabular text-right font-semibold ${c.delta > 0 ? "text-primary" : "text-danger"}`}
                >
                  {formatDelta(c.delta)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default async function ImportPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();
  const { data: imp } = await supabase
    .from("imports")
    .select("id, kind, source, file_name, status, stats, error, created_at, applied_at")
    .eq("id", id)
    .maybeSingle();
  if (!imp || imp.kind !== "quotations") notFound();

  const stats = (imp.stats ?? {}) as ImportStats;
  const preview = stats.preview;
  const anomalies = stats.anomalies ?? [];

  return (
    <>
      <PageHeader
        title={
          imp.status === "applied"
            ? "Import applicato"
            : imp.status === "failed"
              ? "Import annullato"
              : "Anteprima import"
        }
        description={`${imp.file_name ?? "sync automatico"} · caricato il ${formatDateTime(imp.created_at)}`}
      >
        <Link
          href="/admin/listone"
          className="text-primary inline-flex min-h-11 items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden /> Torna al listone
        </Link>
      </PageHeader>

      {imp.status === "failed" && <FormMessage>{imp.error ?? "Import annullato."}</FormMessage>}

      {imp.status === "applied" && (
        <div className="flex flex-col gap-4">
          <FormMessage tone="success">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="size-4" aria-hidden /> Listone aggiornato il{" "}
              {formatDateTime(imp.applied_at)}.
            </span>
          </FormMessage>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Righe" value={formatInt(stats.rows)} />
            <Stat label="Nuovi" value={formatInt(stats.new)} tone="primary" />
            <Stat label="Aggiornati" value={formatInt(stats.updated)} />
            <Stat label="Invariati" value={formatInt(stats.unchanged)} />
            <Stat label="Rientrati" value={formatInt(stats.revived)} />
            <Stat
              label="Fuori lista"
              value={formatInt(stats.out_of_list)}
              tone={stats.out_of_list ? "danger" : "neutral"}
            />
          </div>
          {preview && (
            <ChangesList changes={preview.notableChanges} threshold={preview.threshold ?? 5} />
          )}
          {preview && <PlayerList title="Usciti dal listone" players={preview.outOfList} />}
        </div>
      )}

      {imp.status === "previewed" && preview && (
        <div className="flex flex-col gap-4">
          {preview.isFirstImport && (
            <FormMessage tone="info">
              Primo import: tutti i {formatInt(preview.total)} calciatori verranno creati.
            </FormMessage>
          )}
          {preview.suspicious && (
            <FormMessage>
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="size-4" aria-hidden />
                Attenzione: {formatInt(preview.outOfListCount)} calciatori uscirebbero dal listone.
                Controlla di aver caricato il file completo.
              </span>
            </FormMessage>
          )}
          {stats.storage_error && (
            <FormMessage tone="info">
              Il file non è stato archiviato ({stats.storage_error}); l&apos;import funziona
              comunque.
            </FormMessage>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Nel file" value={formatInt(preview.total)} />
            <Stat label="Nuovi" value={formatInt(preview.newCount)} tone="primary" />
            <Stat label="Aggiornati" value={formatInt(preview.updatedCount)} />
            <Stat label="Invariati" value={formatInt(preview.unchangedCount)} />
            <Stat label="Rientrati" value={formatInt(preview.revivedCount)} />
            <Stat
              label="Fuori lista"
              value={formatInt(preview.outOfListCount)}
              tone={preview.outOfListCount ? "danger" : "neutral"}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Composizione:</span>
            {(["P", "D", "C", "A"] as const).map((r) => (
              <span key={r} className="inline-flex items-center gap-1">
                <RoleBadge role={r} />{" "}
                <span className="tabular">{formatInt(preview.roleCounts[r])}</span>
              </span>
            ))}
            {anomalies.length > 0 && <Badge variant="danger">{anomalies.length} anomalie</Badge>}
          </div>

          <ApplyControls importId={imp.id} />

          <ChangesList changes={preview.notableChanges} threshold={preview.threshold ?? 5} />
          <PlayerList title="Nuovi calciatori" players={preview.newPlayers} />
          <PlayerList title="Rientrano nel listone" players={preview.revivedPlayers} />
          <PlayerList title="Escono dal listone (fuori lista)" players={preview.outOfList} />

          {anomalies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Anomalie rilevate</CardTitle>
                <CardDescription>
                  Righe ignorate o colonne sconosciute: non bloccano l&apos;import.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <TR>
                      <TH>Tipo</TH>
                      <TH>Foglio</TH>
                      <TH>Riga</TH>
                      <TH>Dettaglio</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {anomalies.map((a, i) => (
                      <TR key={i}>
                        <TD>
                          <Badge variant="muted">{a.code}</Badge>
                        </TD>
                        <TD>{a.sheet}</TD>
                        <TD className="tabular">{a.row ?? "—"}</TD>
                        <TD className="text-muted">{a.detail}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
