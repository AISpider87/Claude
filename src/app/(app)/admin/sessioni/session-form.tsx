"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSession } from "@/lib/market/actions";
import type { MarketSession } from "@/lib/supabase/database.types";

/** `opensLocal`/`closesLocal` are "YYYY-MM-DDTHH:mm" in Europe/Rome (see utcToZonedLocal). */
export function SessionForm({
  session,
  opensLocal,
  closesLocal,
}: {
  session?: MarketSession;
  opensLocal?: string;
  closesLocal?: string;
}) {
  const [state, action, pending] = useActionState(saveSession, undefined);
  const locked = session?.status === "closed";

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {session && <input type="hidden" name="id" value={session.id} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Nome</Label>
        <Input
          id="name"
          name="name"
          defaultValue={session?.name ?? ""}
          placeholder="es. Sessione 1 (dopo la 3ª giornata)"
          required
          maxLength={80}
          disabled={locked}
        />
        <FieldError errors={state?.errors?.name} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opensAt">Apertura</Label>
          <Input
            id="opensAt"
            name="opensAt"
            type="datetime-local"
            defaultValue={opensLocal ?? ""}
            required
            disabled={locked}
          />
          <FieldError errors={state?.errors?.opensAt} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="closesAt">Chiusura</Label>
          <Input
            id="closesAt"
            name="closesAt"
            type="datetime-local"
            defaultValue={closesLocal ?? ""}
            required
            disabled={locked}
          />
          <FieldError errors={state?.errors?.closesAt} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="extraBudget">Budget extra all&apos;apertura (crediti per squadra)</Label>
        <Input
          id="extraBudget"
          name="extraBudget"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          defaultValue={session?.extra_budget ?? 5}
          className="tabular"
          disabled={locked || session?.status === "open"}
        />
        <FieldError errors={state?.errors?.extraBudget} />
      </div>
      <FormMessage tone={state?.status === "success" ? "success" : "error"}>
        {state?.message}
      </FormMessage>
      {!locked && (
        <Button type="submit" disabled={pending}>
          {pending ? "Salvataggio…" : session ? "Salva modifiche" : "Crea sessione"}
        </Button>
      )}
    </form>
  );
}
