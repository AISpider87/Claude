import { Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";

export const metadata = { title: "Rosa" };

export default async function RosaPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="La tua rosa" description={`Ciao ${user.displayName}.`} />
      <EmptyState
        icon={Users}
        title="Nessuna squadra collegata"
        description="L'admin deve ancora collegare il tuo account a una squadra della lega. Le rose arrivano nella prossima milestone."
      />
    </>
  );
}
