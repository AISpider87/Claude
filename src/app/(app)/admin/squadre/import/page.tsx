import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { RostersUploadForm } from "./upload-form";

export const metadata = { title: "Import rose" };

const STATUS: Record<string, { label: string; variant: "primary" | "muted" | "danger" }> = {
  applied: { label: "Applicato", variant: "primary" },
  previewed: { label: "In anteprima", variant: "muted" },
  failed: { label: "Annullato", variant: "danger" },
};

export default async function RostersImportPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: imports } = await supabase
    .from("imports")
    .select("id, file_name, status, stats, created_at, applied_at")
    .eq("kind", "rosters")
    .order("created_at", { ascending: false })
    .limit(15);

  return (
    <>
      <PageHeader
        title="Importa le rose"
        description="Export «Rose» di Leghe Fantacalcio: i nomi vengono abbinati al listone, i casi dubbi li risolvi tu."
      >
        <Link
          href="/admin/squadre"
          className="text-primary inline-flex min-h-11 items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden /> Squadre
        </Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle>File Excel</CardTitle>
            <CardDescription>
              Sostituisce la rosa e i crediti (250 − speso) delle squadre presenti nel file; le
              squadre mancanti vengono create. I manager collegati restano collegati.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RostersUploadForm />
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
                  </TR>
                </THead>
                <TBody>
                  {imports.map((imp) => {
                    const s = STATUS[imp.status] ?? STATUS.previewed;
                    return (
                      <TR key={imp.id}>
                        <TD className="whitespace-nowrap">
                          <Link href={`/admin/squadre/import/${imp.id}`} className="text-primary">
                            {formatDateTime(imp.created_at)}
                          </Link>
                        </TD>
                        <TD className="max-w-[12rem] truncate">{imp.file_name ?? "—"}</TD>
                        <TD>
                          <Badge variant={s.variant}>{s.label}</Badge>
                        </TD>
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
