"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveLeagueSettings, setLeagueCode } from "@/lib/admin/actions";
import type { LeagueSettings } from "@/lib/admin/queries";

function NumberField({
  name,
  label,
  value,
  hint,
  errors,
}: {
  name: string;
  label: string;
  value: number;
  hint?: string;
  errors?: string[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type="number"
        inputMode="numeric"
        step={1}
        min={0}
        defaultValue={value}
        className="tabular"
      />
      {hint && <p className="text-muted text-xs">{hint}</p>}
      <FieldError errors={errors} />
    </div>
  );
}

export function SettingsForm({ settings }: { settings: LeagueSettings }) {
  const [state, action, pending] = useActionState(saveLeagueSettings, undefined);
  const e = state?.errors;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Budget e cambi</legend>
        <NumberField
          name="initial_budget"
          label="Budget iniziale"
          value={settings.initial_budget}
          hint="Crediti di partenza (usato nell'import rose)."
          errors={e?.initial_budget}
        />
        <NumberField
          name="session_extra_budget"
          label="Budget extra per sessione"
          value={settings.session_extra_budget}
          hint="Accreditato a tutte le squadre a ogni apertura."
          errors={e?.session_extra_budget}
        />
        <NumberField
          name="season_swap_limit"
          label="Cambi a stagione per squadra"
          value={settings.season_swap_limit}
          hint="I cambi gratuiti dei fuori lista non contano."
          errors={e?.season_swap_limit}
        />
        <NumberField
          name="market_ops_per_minute"
          label="Operazioni al minuto per squadra"
          value={settings.market_ops_per_minute}
          hint="Freno anti-abuso applicato dal database."
          errors={e?.market_ops_per_minute}
        />
      </fieldset>

      <fieldset className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold">Composizione della rosa</legend>
        <NumberField
          name="composition_P"
          label="Portieri"
          value={settings.roster_composition.P}
          errors={e?.composition_P}
        />
        <NumberField
          name="composition_D"
          label="Difensori"
          value={settings.roster_composition.D}
          errors={e?.composition_D}
        />
        <NumberField
          name="composition_C"
          label="Centrocampisti"
          value={settings.roster_composition.C}
          errors={e?.composition_C}
        />
        <NumberField
          name="composition_A"
          label="Attaccanti"
          value={settings.roster_composition.A}
          errors={e?.composition_A}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">Automazioni</legend>
        <NumberField
          name="quotation_change_alert_threshold"
          label="Soglia variazioni quotazione"
          value={settings.quotation_change_alert_threshold}
          hint="Le variazioni di Qt.A oltre questa soglia vengono evidenziate negli import."
          errors={e?.quotation_change_alert_threshold}
        />
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="sync_enabled"
            defaultChecked={settings.sync_enabled}
            className="accent-primary size-5"
          />
          Aggiornamento automatico delle quotazioni (cron giornaliero)
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="notifications_enabled"
            defaultChecked={settings.notifications_enabled}
            className="accent-primary size-5"
          />
          Email alla lega all&rsquo;apertura e alla chiusura delle sessioni
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="notifications_free_swap"
            defaultChecked={settings.notifications_free_swap}
            className="accent-primary size-5"
          />
          Email agli admin a ogni cambio gratuito (fuori lista)
        </label>
      </fieldset>

      <FormMessage tone={state?.status === "success" ? "success" : "error"}>
        {state?.message}
      </FormMessage>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvataggio…" : "Salva impostazioni"}
        </Button>
      </div>
    </form>
  );
}

export function LeagueCodeForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState(setLeagueCode, undefined);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code">Codice lega</Label>
        <Input
          id="code"
          name="code"
          defaultValue={code}
          autoComplete="off"
          spellCheck={false}
          className="font-display tracking-wider uppercase"
        />
        <p className="text-muted text-xs">
          Serve per registrarsi. Cambialo se è finito nelle mani sbagliate: chi è già iscritto non
          ne ha più bisogno.
        </p>
        <FieldError errors={state?.errors?.code} />
      </div>
      <FormMessage tone={state?.status === "success" ? "success" : "error"}>
        {state?.message}
      </FormMessage>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Salvataggio…" : "Aggiorna codice"}
        </Button>
      </div>
    </form>
  );
}
