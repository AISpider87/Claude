import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/dal";
import { syncMarketSessions } from "@/lib/market/sync";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Scheduled sessions open and expired ones close at the first page load after their time.
  await syncMarketSessions();
  return <AppShell user={user}>{children}</AppShell>;
}
