import { Repeat } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Mercato" };

export default function MercatoPage() {
  return (
    <>
      <PageHeader title="Mercato" description="Sessioni, cambi e bacheca della lega." />
      <EmptyState
        icon={Repeat}
        title="Nessuna sessione aperta"
        description="Quando l'admin aprirà una sessione di mercato potrai fare i tuoi cambi da qui."
      />
    </>
  );
}
