import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Conferma email" };

export default function VerifyEmailPage() {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <MailCheck className="text-primary size-10" aria-hidden />
        <CardTitle>Controlla la tua email</CardTitle>
        <CardDescription>
          Ti abbiamo inviato un link di conferma. Aprilo dal telefono o dal computer per attivare
          l&apos;account: se non lo trovi, guarda nello spam.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted text-center text-sm">
        Dopo la conferma potrai{" "}
        <Link href="/login" className="text-primary font-medium">
          accedere
        </Link>
        .
      </CardContent>
    </Card>
  );
}
