import { Badge, RoleBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { API_FOOTBALL_PROVIDER } from "@/lib/availability/provider";
import { getAvailabilityFeedState } from "@/lib/availability/queries";
import { formatDateTime, formatInt } from "@/lib/format";
import { listPlayerStatuses, STATUS_LABEL } from "@/lib/players/status";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { CronSql, MapRowForm, RawSamples, RunFeedButton, type UnmatchedRow } from "./feed-panel";
import { ClearStatusButton, StatusForm } from "./status-form";

export const metadata = { title: "Indisponibili" };

const KIND_VARIANT = {
  injured: "danger",
  doubtful: "primary",
  suspended: "muted",
  unavailable: "muted",
} as const;

const RUN_LABEL: Record<string, string> = {
  ok: "riuscito",
  partial: "riuscito con avvisi",
  failed: "non riuscito",
};

export default async function AdminPlayerStatusPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: cronToken }, statuses, players, feed] = await Promise.all([
    supabase.rpc("admin_cron_token"),
    listPlayerStatuses(),
    fetchAll(() =>
      supabase
        .from("players")
        .select("id, name, team, role_classic")
        .eq("status", "active")
        .order("name"),
    ),
    getAvailabilityFeedState(),
  ]);

  const playerOptions = players.map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    role: p.role_classic,
  }));
  const byId = new Map(playerOptions.map((p) => [p.id, p]));
  const run = feed.lastRun;
  const runStatus = typeof run?.status === "string" ? run.status : null;
  const errors = Array.isArray(run?.errors) ? run.errors : [];
  const unmatched: UnmatchedRow[] = (Array.isArray(run?.unmatched) ? run.unmatched : []).map(
    (u) => ({
      externalId: u.external_id ?? null,
      name: u.name,
      team: u.team,
      kind:
        u.kind === "ambiguous" || u.kind === "to_confirm"
          ? u.kind
          : ("not_found" as UnmatchedRow["kind"]),
      detail: u.detail ?? "",
      suggestions: (u.candidates ?? []).flatMap((c) => {
        const p = byId.get(c.id);
        return p ? [p] : [];
      }),
    }),
  );
  const manualCount = statuses.filter((s) => s.origin === "manual").length;

  return (
    <>
      <PageHeader
        title="Indisponibili"
        description="Infortunati, squalificati e in dubbio: i manager li vedono nella propria rosa con la fonte della notizia."
      />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Feed automatico ({feed.providerLabel})</CardTitle>
            <CardDescription>
              Ogni 15 minuti il feed aggiorna indisponibili e formazioni ufficiali. Gli stati che
              scrivi tu a mano non vengono mai sovrascritti:{" "}
              <strong>il manuale batte il feed</strong>. Per togliere uno stato messo dal feed,
              segna il calciatore come &quot;Disponibile&quot;: tornerà solo se l&apos;API lo
              riporta.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!feed.configured && (
              <FormMessage tone="info">
                {feed.keyVar ? (
                  <>
                    Nessuna chiave <code>{feed.keyVar}</code> configurata su questo ambiente: il
                    feed è spento e restano solo gli stati manuali.
                  </>
                ) : (
                  <>
                    Nessun fornitore configurato (<code>AVAILABILITY_PROVIDER</code>,{" "}
                    <code>BSD_API_KEY</code>): il feed è spento e restano solo gli stati manuali.
                  </>
                )}
              </FormMessage>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Ultimo aggiornamento"
                value={feed.syncedAt ? formatDateTime(feed.syncedAt) : "mai"}
                className="col-span-2"
              />
              <Stat
                label="Esito"
                value={runStatus ? (RUN_LABEL[runStatus] ?? runStatus) : "—"}
                tone={runStatus === "ok" ? "primary" : runStatus ? "danger" : "neutral"}
              />
              <Stat
                label="Richieste API"
                value={`${formatInt(run?.requests ?? 0)}/${formatInt(run?.requests_max ?? 3)}`}
              />
              <Stat label="Stati dal feed" value={formatInt(run?.statuses_applied ?? 0)} />
              <Stat
                label="Stati manuali tenuti"
                value={formatInt(run?.statuses_kept_manual ?? 0)}
              />
              <Stat label="Rientri (stato tolto)" value={formatInt(run?.statuses_cleared ?? 0)} />
              <Stat label="In formazione" value={formatInt(run?.lineups ?? 0)} />
            </div>
            {run?.fixture && (
              <p className="text-muted text-sm">
                Formazioni lette per {run.fixture.label} delle {formatDateTime(run.fixture.kickoff)}
                .
              </p>
            )}
            {typeof run?.rate_limit_remaining === "number" && (
              <p className="text-muted text-sm">
                Quota giornaliera residua dichiarata dall&apos;API:{" "}
                {formatInt(run.rate_limit_remaining)}.
              </p>
            )}
            {Array.isArray(run?.notes) && run.notes.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold">Rotte del fornitore</p>
                <ul className="text-muted list-disc pl-5 text-sm">
                  {run.notes.map((n, i) => (
                    <li key={i} className="break-words">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(run?.unparsed ?? 0) > 0 && (
              <p className="text-muted text-sm">
                {formatInt(run?.unparsed ?? 0)} righe ricevute ma non leggibili (nome o stato in un
                campo che non conosciamo): guarda la risposta grezza qui sotto.
              </p>
            )}
            {errors.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-danger text-sm font-semibold">
                  Errori dell&apos;ultimo tentativo
                </p>
                <ul className="text-danger list-disc pl-5 text-sm">
                  {errors.map((e, i) => (
                    <li key={i} className="break-words">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <RunFeedButton disabled={!feed.configured} />
            <RawSamples
              samples={feed.samples?.samples ?? []}
              savedAt={feed.samples?.savedAt ? formatDateTime(feed.samples.savedAt) : null}
              endpoints={feed.endpoints}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aggiornamento ogni 15 minuti</CardTitle>
            <CardDescription>
              Da fare una volta sola: apri il progetto su supabase.com, vai in{" "}
              <strong>SQL Editor → New query</strong>, incolla il comando qui sotto e premi{" "}
              <strong>Run</strong>. Da quel momento il feed si aggiorna da solo, anche quando
              nessuno apre l&apos;app. Il comando contiene già la chiave generata dal database: non
              serve copiarla da Vercel. Per fermarlo:{" "}
              <code>select cron.unschedule(&apos;superlega-availability&apos;);</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cronToken ? (
              <CronSql
                sql={`create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'superlega-availability',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := '${publicEnv.NEXT_PUBLIC_SITE_URL}/api/cron/sync-availability',
    headers := jsonb_build_object('Authorization', 'Bearer ${cronToken}'),
    timeout_milliseconds := 55000
  );
  $$
);`}
              />
            ) : (
              <FormMessage>
                Chiave del programmatore non disponibile: esegui l&apos;ultimo aggiornamento SQL e
                ricarica la pagina.
              </FormMessage>
            )}
          </CardContent>
        </Card>

        {unmatched.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nomi da abbinare ({unmatched.length})</CardTitle>
              <CardDescription>
                L&apos;API usa nomi diversi dal listone. Scegli tu il calciatore giusto:
                l&apos;abbinamento resta valido per i prossimi aggiornamenti. Le righe{" "}
                <strong>da confermare</strong> sono già state applicate (l&apos;abbinamento è
                probabile ma il club non era verificabile): confermale per non doverle indovinare
                ogni volta.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {unmatched.map((row) => (
                <MapRowForm
                  key={`${row.externalId ?? "?"}-${row.name}`}
                  row={row}
                  players={playerOptions}
                  provider={feed.provider ?? API_FOOTBALL_PROVIDER}
                />
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Segna un calciatore</CardTitle>
            <CardDescription>
              Indica sempre la fonte: compare accanto allo stato, con la data
              dell&apos;aggiornamento. Quello che scrivi qui vince sul feed automatico e resta
              finché non lo cambi tu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StatusForm players={playerOptions} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stati attivi ({statuses.length})</CardTitle>
            <CardDescription>
              {manualCount > 0
                ? `${manualCount} scritti a mano (il feed non li tocca), gli altri dal feed automatico. `
                : "Tutti dal feed automatico. "}
              &quot;Disponibile&quot; rimuove lo stato. Gli stati manuali non scadono da soli:
              aggiornali quando il calciatore rientra.
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
                    <TH>Origine</TH>
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
                      <TD>
                        <Badge variant={s.origin === "manual" ? "primary" : "muted"}>
                          {s.origin === "manual" ? "manuale" : "feed"}
                        </Badge>
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
