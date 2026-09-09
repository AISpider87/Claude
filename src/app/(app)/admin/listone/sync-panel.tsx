"use client";

import { useActionState } from "react";
import { Power, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { runSyncNow, setSyncEnabled } from "@/lib/sync/actions";

export function SyncPanel({
  enabled,
  sourceConfigured,
}: {
  enabled: boolean;
  sourceConfigured: boolean;
}) {
  const [toggleState, toggleAction, toggling] = useActionState(setSyncEnabled, undefined);
  const [runState, runAction, running] = useActionState(runSyncNow, undefined);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Stato:{" "}
        <span className={enabled ? "text-primary font-semibold" : "text-muted font-semibold"}>
          {enabled ? "attivo" : "disattivato"}
        </span>
        {" · "}
        Sorgente:{" "}
        <span className={sourceConfigured ? "font-semibold" : "text-muted"}>
          {sourceConfigured ? "configurata" : "non configurata (solo upload manuale)"}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <form action={toggleAction}>
          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
          <Button type="submit" variant="secondary" disabled={toggling}>
            <Power className="size-4" aria-hidden />
            {toggling ? "…" : enabled ? "Disattiva sync" : "Attiva sync"}
          </Button>
        </form>
        <form action={runAction}>
          <Button type="submit" variant="secondary" disabled={running || !sourceConfigured}>
            <RefreshCw className={`size-4 ${running ? "animate-spin" : ""}`} aria-hidden />
            {running ? "Sync in corso…" : "Esegui ora"}
          </Button>
        </form>
      </div>
      <FormMessage tone={toggleState?.status === "success" ? "success" : "error"}>
        {toggleState?.message}
      </FormMessage>
      <FormMessage tone={runState?.status === "success" ? "success" : "error"}>
        {runState?.message}
      </FormMessage>
    </div>
  );
}
