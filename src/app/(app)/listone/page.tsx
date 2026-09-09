import { List } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Listone" };

export default function ListonePage() {
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
