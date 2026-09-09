import { List } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { getAllPlayers, getOwnedPlayerIds } from "@/lib/teams/queries";
import { ListoneBrowser } from "./listone-browser";

export const metadata = { title: "Listone" };

export default async function ListonePage() {
  await requireUser();
  const [players, owned] = await Promise.all([getAllPlayers(), getOwnedPlayerIds()]);

  if (players.length === 0) {
    return (
      <>
        <PageHeader title="Listone" description="Quotazioni Fantacalcio.it e svincolati." />
        <EmptyState
          icon={List}
          title="Listone non ancora importato"
          description="L'admin importerà le quotazioni ufficiali. Qui troverai ricerca e filtri."
        />
      </>
    );
  }

  const rows = players.map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    role: p.role_classic,
    qtA: p.qt_a,
    qtI: p.qt_i,
    fvm: p.fvm,
    status: p.status,
    owned: owned.has(p.id),
  }));

  return (
    <>
      <PageHeader
        title="Listone"
        description={`${rows.filter((r) => r.status === "active").length} calciatori quotati · ${rows.filter((r) => !r.owned && r.status === "active").length} svincolati`}
      />
      <ListoneBrowser rows={rows} />
    </>
  );
}
