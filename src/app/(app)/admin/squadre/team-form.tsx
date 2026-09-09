"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Team } from "@/lib/supabase/database.types";
import { saveTeam } from "@/lib/teams/actions";

export function TeamForm({ team }: { team?: Team }) {
  const [state, action, pending] = useActionState(saveTeam, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {team && <input type="hidden" name="id" value={team.id} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Nome squadra</Label>
        <Input id="name" name="name" defaultValue={team?.name ?? ""} required maxLength={60} />
        <FieldError errors={state?.errors?.name} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shortName">Sigla</Label>
          <Input
            id="shortName"
            name="shortName"
            defaultValue={team?.short_name ?? ""}
            maxLength={4}
            placeholder="auto"
            className="font-display uppercase"
          />
          <FieldError errors={state?.errors?.shortName} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="colorPrimary">Colore 1</Label>
          <Input
            id="colorPrimary"
            name="colorPrimary"
            type="color"
            defaultValue={team?.color_primary ?? "#38bdf8"}
            className="p-1"
          />
          <FieldError errors={state?.errors?.colorPrimary} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="colorSecondary">Colore 2</Label>
          <Input
            id="colorSecondary"
            name="colorSecondary"
            type="color"
            defaultValue={team?.color_secondary ?? "#0b1220"}
            className="p-1"
          />
          <FieldError errors={state?.errors?.colorSecondary} />
        </div>
      </div>
      <FormMessage tone={state?.status === "success" ? "success" : "error"}>
        {state?.message}
      </FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? "Salvataggio…" : team ? "Salva modifiche" : "Crea squadra"}
      </Button>
    </form>
  );
}
