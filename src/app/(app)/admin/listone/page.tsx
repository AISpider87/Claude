import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime, formatInt } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Listone" };

const STATUS_LABEL: Record<string, { label: string; variant: "primary" | "muted" | "danger" }> = {
  applied: { label: "Applicato", variant: "primary" },
  previewed: { label: "In anteprima", variant: "muted" },
  failed: { label: "Annullato", variant: "danger" },
};

export default async function AdminListonePage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ count: activeCount }, { count: outCount }, { data: imports }] = await Promise.all([
    supabase.from("players").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase
      .from("players")
      .select("id", { count: "exact", head: true })
      .eq("status", "out_of_list"),
    supabase
      .from("imports")
      .select("id, kind, source, file_name, status, stats, created_at, applied_at")
      .eq("kind", "quotations")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const lastApplied = imports?.find((i) => i.status === "applied");

  return (
    <>
      <PageHeader
        title="Listone e quotazioni"
        description="Importa il file Excel ufficiale: prima vedi le differenze, poi confermi."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Calciatori attivi" value={formatInt(activeCount ?? 0)} tone="primary" />
        <Stat label="Fuori lista" value={formatInt(outCount ?? 0)} />
        <Stat
          label="Ultimo import"
          value={
            <span className="text-base">
              {lastApplied ? formatDateTime(lastApplied.applied_at) : "mai"}
            </span>
          }
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Nuovo import</CardTitle>
            <CardDescription>
              File <code>Quotazioni_Fantacalcio_Stagione_….xlsx</code> scaricato da Fantacalcio.it.
              I calciatori assenti dal file o nel foglio &quot;Ceduti&quot; diventano fuori lista,
              mai cancellati.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UploadForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ultimi import</CardTitle>
          </CardHeader>
          <CardContent>
            {!imports?.length ? (
              <p className="text-muted text-sm">Nessun import ancora.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Data</TH>
                    <TH>File</TH>
                    <TH>Stato</TH>
                    <TH className="text-right">Righe</TH>
                    <TH className="text-right">Nuovi</TH>
                    <TH className="text-right">Fuori</TH>
                  </TR>
                </THead>
                <TBody>
                  {imports.map((imp) => {
                    const stats = (imp.stats ?? {}) as Record<string, unknown>;
                    const preview = (stats.preview ?? {}) as Record<string, unknown>;
                    const rows =
                      (stats.rows as number | undefined) ?? (preview.total as number | undefined);
                    const fresh =
                      (stats.new as number | undefined) ?? (preview.newCount as number | undefined);
                    const out =
                      (stats.out_of_list as number | undefined) ??
                      (preview.outOfListCount as number | undefined);
                    const status = STATUS_LABEL[imp.status] ?? STATUS_LABEL.previewed;
                    return (
                      <TR key={imp.id}>
                        <TD className="whitespace-nowrap">
                          <Link href={`/admin/listone/import/${imp.id}`} className="text-primary">
                            {formatDateTime(imp.created_at)}
                          </Link>
                        </TD>
                        <TD className="max-w-[12rem] truncate" title={imp.file_name ?? ""}>
                          {imp.file_name ?? (imp.source === "auto" ? "sync automatico" : "—")}
                        </TD>
                        <TD>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </TD>
                        <TD className="tabular text-right">{formatInt(rows)}</TD>
                        <TD className="tabular text-right">{formatInt(fresh)}</TD>
                        <TD className="tabular text-right">{formatInt(out)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
