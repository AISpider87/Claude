"use client";

import { useSyncExternalStore } from "react";
import { Smartphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Platform = "unknown" | "ios" | "other" | "installed";

function subscribe() {
  return () => {};
}

function getPlatform(): Platform {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone));
  if (standalone) return "installed";
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ? "ios" : "other";
}

/** Explains how to add SuperLega to the home screen; hidden when already installed. */
export function InstallHint() {
  const platform = useSyncExternalStore(subscribe, getPlatform, () => "unknown" as Platform);

  if (platform === "installed" || platform === "unknown") return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <Smartphone className="text-primary size-5" aria-hidden />
        <CardTitle className="text-base">Installa SuperLega</CardTitle>
      </CardHeader>
      <CardContent className="text-muted text-sm">
        {platform === "ios"
          ? "Su iPhone: tocca Condividi in Safari, poi «Aggiungi alla schermata Home»."
          : "Su Android e computer: apri il menu del browser e scegli «Installa app» o «Aggiungi a schermata Home»."}
      </CardContent>
    </Card>
  );
}
