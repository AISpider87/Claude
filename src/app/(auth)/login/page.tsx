import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { safeNext } from "@/lib/auth/redirect";
import { LoginForm } from "./login-form";

export const metadata = { title: "Accedi" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Accedi</CardTitle>
        <CardDescription>Entra con l&apos;email e la password della tua squadra.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {params.error === "link" && (
          <FormMessage>Il link non è più valido. Accedi o richiedi un nuovo link.</FormMessage>
        )}
        <LoginForm next={next} />
        <div className="text-muted flex flex-col gap-2 text-center text-sm">
          <Link href="/password-dimenticata" className="hover:text-primary">
            Password dimenticata?
          </Link>
          <span>
            Non hai un account?{" "}
            <Link href="/registrati" className="text-primary font-medium">
              Registrati
            </Link>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
