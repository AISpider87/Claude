import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listUsers } from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDate, formatInt } from "@/lib/format";
import { UserActions } from "./user-forms";

export const metadata = { title: "Utenti" };

export default async function AdminUsersPage() {
  const me = await requireAdmin();
  const users = await listUsers();
  const admins = users.filter((u) => u.role === "admin").length;
  const active = users.filter((u) => u.is_active).length;
  const withoutTeam = users.filter((u) => u.is_active && u.role === "manager" && !u.team_id);

  return (
    <>
      <PageHeader
        title="Utenti"
        description="Chi si è registrato con il codice lega: ruoli, stato e squadra collegata."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Iscritti" value={formatInt(users.length)} tone="primary" />
        <Stat label="Attivi" value={formatInt(active)} />
        <Stat label="Admin" value={formatInt(admins)} />
        <Stat
          label="Senza squadra"
          value={formatInt(withoutTeam.length)}
          tone={withoutTeam.length ? "danger" : "neutral"}
        />
      </div>

      {withoutTeam.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Manager da collegare</CardTitle>
            <CardDescription>
              Apri la squadra giusta da{" "}
              <Link href="/admin/squadre" className="text-primary">
                Squadre e rose
              </Link>{" "}
              e usa &ldquo;Collega manager&rdquo;.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {withoutTeam.map((u) => (
              <Badge key={u.user_id} variant="danger">
                {u.display_name}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tutti gli utenti</CardTitle>
          <CardDescription>
            Le email sono visibili solo agli admin. Un account disattivato non può più entrare.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-muted text-sm">Nessun utente registrato.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Utente</TH>
                  <TH>Squadra</TH>
                  <TH>Ruolo</TH>
                  <TH>Stato</TH>
                  <TH className="text-right">Azioni</TH>
                </TR>
              </THead>
              <TBody>
                {users.map((u) => (
                  <TR key={u.user_id} className={u.is_active ? undefined : "opacity-60"}>
                    <TD>
                      <span className="font-medium">{u.display_name}</span>
                      <span className="text-muted block text-xs">{u.email ?? "—"}</span>
                      <span className="text-muted block text-xs">
                        dal {formatDate(u.created_at)}
                      </span>
                    </TD>
                    <TD>
                      {u.team_id ? (
                        <Link href={`/admin/squadre/${u.team_id}`} className="text-primary">
                          {u.team_name}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </TD>
                    <TD>
                      <Badge variant={u.role === "admin" ? "primary" : "neutral"}>
                        {u.role === "admin" ? "Admin" : "Manager"}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge variant={u.is_active ? "muted" : "danger"}>
                        {u.is_active ? "Attivo" : "Disattivato"}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <UserActions user={u} isSelf={u.user_id === me.id} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
