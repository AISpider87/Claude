import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";

export const metadata = { title: "Account disattivato" };

export default function DeactivatedPage() {
  return (
    <main
      id="main"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <Ban className="text-danger size-12" aria-hidden />
      <h1 className="font-display text-2xl font-semibold">Account disattivato</h1>
      <p className="text-muted max-w-sm">
        Il tuo account è stato disattivato dall&apos;admin della lega. Contattalo per maggiori
        informazioni.
      </p>
      <form action={signOut}>
        <Button type="submit" variant="secondary">
          Esci
        </Button>
      </form>
    </main>
  );
}
