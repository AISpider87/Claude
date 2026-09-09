import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetRequestForm } from "./reset-request-form";

export const metadata = { title: "Recupera password" };

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recupera la password</CardTitle>
        <CardDescription>Ti mandiamo un link per sceglierne una nuova.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ResetRequestForm />
        <p className="text-muted text-center text-sm">
          <Link href="/login" className="hover:text-primary">
            Torna al login
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
