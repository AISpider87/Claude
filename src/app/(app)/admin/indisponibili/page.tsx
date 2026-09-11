import { Badge, RoleBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { listPlayerStatuses, STATUS_LABEL } from "@/lib/players/status";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";
import { ClearStatusButton, StatusForm } from "./status-form";

export const metadata = { title: "Indisponibili" };

const KIND_VARIANT = {
  injured: "danger",
  doubtful: "primary",
  suspended: "muted",
  unavailable: "muted",
} as const;

export default async function AdminPlayerStatusPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [statuses, players] = await Promise.all([
    listPlayerStatuses(),
    fetchAll(() =>
      supabase
        .from("players")
        .select("id, name, team, role_classic")
        .eq("status", "active")
        .order("name"),
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Indisponibili"
        description="Infortunati, squalificati e in dubbio: i manager li vedono nella propria rosa con la fonte della notizia."
      />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Segna un calciatore</CardTitle>
            <CardDescription>
              Indica sempre la fonte: compare accanto allo stato, con la data
              dell&apos;aggiornamento.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StatusForm
              players={players.map((p) => ({
                id: p.id,
                name: p.name,
                team: p.team,
                role: p.role_classic,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stati attivi ({statuses.length})</CardTitle>
            <CardDescription>
              &quot;Disponibile&quot; rimuove lo stato. Gli stati non scadono da soli: aggiornali
              quando il calciatore rientra.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {statuses.length === 0 ? (
              <p className="text-muted text-sm">Nessun calciatore segnato.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Calciatore</TH>
                    <TH>Stato</TH>
                    <TH>Fonte</TH>
                    <TH>Aggiornato</TH>
                    <TH className="text-right">Azioni</TH>
                  </TR>
                </THead>
                <TBody>
                  {statuses.map((s) => (
                    <TR key={s.player_id}>
                      <TD>
                        <span className="inline-flex items-center gap-2 font-medium">
                          <RoleBadge role={s.role} className="size-5 text-[10px]" /> {s.name}
                          <span className="text-muted font-normal">· {s.team}</span>
                        </span>
                      </TD>
                      <TD>
                        <Badge variant={KIND_VARIANT[s.kind]}>{STATUS_LABEL[s.kind]}</Badge>
                        {s.note && <span className="text-muted block text-xs">{s.note}</span>}
                      </TD>
                      <TD className="text-sm">
                        {s.source_url ? (
                          <a
                            href={s.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary"
                          >
                            {s.source_name ?? "fonte"} ↗
                          </a>
                        ) : (
                          (s.source_name ?? "—")
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">{formatDateTime(s.updated_at)}</TD>
                      <TD className="text-right">
                        <ClearStatusButton playerId={s.player_id} name={s.name} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
