import Link from "next/link";
import { Upload } from "lucide-react";
import { TeamEmblem } from "@/components/roster/team-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatInt } from "@/lib/format";
import { listTeams } from "@/lib/teams/queries";
import { TeamForm } from "./team-form";

export const metadata = { title: "Squadre" };

export default async function AdminTeamsPage() {
  await requireAdmin();
  const teams = await listTeams();
  const unlinked = teams.filter((t) => !t.owner_id).length;

  return (
    <>
      <PageHeader
        title="Squadre e rose"
        description={`${teams.length} squadre · ${unlinked} senza manager collegato`}
      >
        <Link href="/admin/squadre/import" className={buttonVariants({ variant: "primary" })}>
          <Upload className="size-4" aria-hidden /> Importa le rose
        </Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Elenco squadre</CardTitle>
          </CardHeader>
          <CardContent>
            {teams.length === 0 ? (
              <p className="text-muted text-sm">
                Nessuna squadra: importa l&apos;export &quot;Rose&quot; o creane una a destra.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Squadra</TH>
                    <TH>Manager</TH>
                    <TH className="text-right">Crediti</TH>
                    <TH className="text-right">Rosa</TH>
                    <TH className="text-right">Cambi</TH>
                  </TR>
                </THead>
                <TBody>
                  {teams.map((t) => (
                    <TR key={t.id}>
                      <TD>
                        <Link
                          href={`/admin/squadre/${t.id}`}
                          className="inline-flex items-center gap-2 font-medium"
                        >
                          <TeamEmblem team={t} size="sm" />
                          <span className="text-primary">{t.name}</span>
                        </Link>
                      </TD>
                      <TD>{t.ownerName ?? <Badge variant="danger">da collegare</Badge>}</TD>
                      <TD className="tabular text-right">{formatInt(t.credits)}</TD>
                      <TD className="tabular text-right">{t.rosterCount}/23</TD>
                      <TD className="tabular text-right">{t.swaps_used}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nuova squadra</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
