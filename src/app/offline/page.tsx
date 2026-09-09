import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main
      id="main"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <WifiOff className="text-primary size-12" aria-hidden />
      <h1 className="font-display text-2xl font-semibold">Sei offline</h1>
      <p className="text-muted max-w-sm">
        SuperLega ha bisogno della connessione per mostrare rose e mercato. Riprova appena torni
        online.
      </p>
    </main>
  );
}
