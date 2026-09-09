import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RosterTable } from "@/components/roster/roster-table";
import { TeamEmblem, TeamStats } from "@/components/roster/team-header";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { getRosterComposition, getTeam, getTeamRoster, summarizeRoster } from "@/lib/teams/queries";

export const metadata = { title: "Squadra" };

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const team = await getTeam(id);
  if (!team) notFound();

  const supabase = await createClient();
  const [roster, composition, { data: owner }] = await Promise.all([
    getTeamRoster(team.id),
    getRosterComposition(),
    team.owner_id
      ? supabase.from("profiles").select("display_name").eq("user_id", team.owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const summary = summarizeRoster(roster);

  return (
    <>
      <PageHeader
        title={team.name}
        description={
          owner?.display_name ? `Manager: ${owner.display_name}` : "Manager non collegato"
        }
      >
        <TeamEmblem team={team} size="lg" />
      </PageHeader>
      <div className="flex flex-col gap-6">
        <TeamStats team={team} summary={summary} composition={composition} />
        <RosterTable roster={roster} composition={composition} />
        <Link
          href="/squadre"
          className="text-primary inline-flex min-h-11 items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden /> Tutte le squadre
        </Link>
      </div>
    </>
  );
}
