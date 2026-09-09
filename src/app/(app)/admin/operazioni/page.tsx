import { LedgerTable } from "@/components/market/ledger-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth/dal";
import { listTransactions } from "@/lib/market/queries";
import { ReverseButton } from "./reverse-button";

export const metadata = { title: "Registro operazioni" };

export default async function AdminLedgerPage() {
  await requireAdmin();
  const ledger = await listTransactions({ limit: 200 });

  return (
    <>
      <PageHeader
        title="Registro operazioni"
        description="Tutte le operazioni della lega. L'annullamento crea l'operazione inversa, non cancella nulla."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ultime 200 operazioni</CardTitle>
          <CardDescription>Le operazioni annullate restano visibili, in grigio.</CardDescription>
        </CardHeader>
        <CardContent>
          <LedgerTable
            rows={ledger}
            actions={(t) =>
              t.kind !== "reversal" && !t.reversed ? <ReverseButton txId={t.id} /> : null
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
