import Link from "next/link";
import { ArrowRight, List, Repeat, ScrollText, Settings, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth/dal";

export const metadata = { title: "Admin" };

const SECTIONS = [
  {
    href: "/admin/listone",
    icon: List,
    title: "Listone e quotazioni",
    description: "Importa il file Excel di Fantacalcio.it con anteprima delle differenze.",
    ready: true,
  },
  {
    href: "/admin/squadre",
    icon: Users,
    title: "Squadre e rose",
    description: "Import delle rose, crediti e collegamento dei manager.",
    ready: true,
  },
  {
    href: "/admin/sessioni",
    icon: Repeat,
    title: "Sessioni di mercato",
    description: "Programma, apri e chiudi le sessioni con il report di validazione.",
    ready: true,
  },
  {
    href: "/admin/operazioni",
    icon: ScrollText,
    title: "Registro operazioni",
    description: "Tutte le operazioni della lega; annullamento con motivazione.",
    ready: true,
  },
  {
    href: "/admin/impostazioni",
    icon: Settings,
    title: "Impostazioni lega",
    description: "Codice lega, budget, limiti, utenti e log.",
    ready: false,
  },
];

export default async function AdminPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Pannello admin" description="Gestione della SuperLega." />
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map(({ href, icon: Icon, title, description, ready }) => (
          <Card key={href} className={ready ? undefined : "opacity-60"}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Icon className="text-primary size-5" aria-hidden />
                <CardTitle className="text-base">{title}</CardTitle>
              </div>
              <CardDescription>{description}</CardDescription>
              {ready ? (
                <Link
                  href={href}
                  className="text-primary inline-flex min-h-11 items-center gap-1 text-sm font-medium"
                >
                  Apri <ArrowRight className="size-4" aria-hidden />
                </Link>
              ) : (
                <span className="text-muted text-xs">In arrivo nelle prossime milestone</span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
