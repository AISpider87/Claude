import { Shield } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth/dal";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Pannello admin" description="Utenti, squadre, import, sessioni." />
      <EmptyState
        icon={Shield}
        title="Pannello in costruzione"
        description="Import del listone e gestione squadre arrivano con le prossime milestone."
      />
    </>
  );
}
