import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignUpForm } from "./signup-form";

export const metadata = { title: "Registrati" };

export default function SignUpPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Crea il tuo account</CardTitle>
        <CardDescription>
          Serve il codice della lega: te lo dà l&apos;admin. Dopo la registrazione riceverai
          un&apos;email di conferma.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SignUpForm />
        <p className="text-muted text-center text-sm">
          Hai già un account?{" "}
          <Link href="/login" className="text-primary font-medium">
            Accedi
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
