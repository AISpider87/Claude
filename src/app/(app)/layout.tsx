import { AppShell } from "@/components/layout/app-shell";
import { refreshAvailabilityIfStale } from "@/lib/availability/refresh";
import { requireUser } from "@/lib/auth/dal";
import { syncMarketSessions } from "@/lib/market/sync";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Scheduled sessions open and expired ones close at the first page load after their time.
  await syncMarketSessions();
  // Indisponibili/formazioni: refreshed in the background if the schedule has not.
  refreshAvailabilityIfStale();
  return <AppShell user={user}>{children}</AppShell>;
}
