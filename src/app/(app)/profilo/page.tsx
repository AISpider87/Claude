import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { SignOutButton } from "./sign-out-button";
import { InstallHint } from "./install-hint";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export const metadata = { title: "Profilo" };

export default async function ProfiloPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Profilo" />
      <div className="flex max-w-lg flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{user.displayName}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-muted">{user.email}</p>
            <p>
              Ruolo:{" "}
              <span className="border-line bg-surface-2 rounded-full border px-2 py-0.5 text-xs font-medium uppercase">
                {user.role === "admin" ? "Admin" : "Manager"}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <SignOutButton />
              <ThemeToggle showLabel className="border-line border" />
            </div>
          </CardContent>
        </Card>
        <InstallHint />
      </div>
    </>
  );
}
