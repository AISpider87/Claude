import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata = { title: "Nuova password" };

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scegli una nuova password</CardTitle>
        <CardDescription>Almeno 8 caratteri. La userai dal prossimo accesso.</CardDescription>
      </CardHeader>
      <CardContent>
        <UpdatePasswordForm />
      </CardContent>
    </Card>
  );
}
