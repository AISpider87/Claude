"use client";

import { useActionState, useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { assignPlayer, removePlayer, setTeamCredits, setTeamOwner } from "@/lib/teams/actions";

const selectClass =
  "border-line bg-surface text-foreground min-h-11 w-full rounded-[var(--radius-control)] border px-3 text-base";

export function OwnerForm({
  teamId,
  ownerId,
  users,
}: {
  teamId: string;
  ownerId: string | null;
  users: { user_id: string; display_name: string; role: string }[];
}) {
  const [state, action, pending] = useActionState(setTeamOwner, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="teamId" value={teamId} />
      <Label htmlFor="userId">Utente</Label>
      <select id="userId" name="userId" defaultValue={ownerId ?? ""} className={selectClass}>
        <option value="">— nessuno —</option>
        {users.map((u) => (
          <option key={u.user_id} value={u.user_id}>
            {u.display_name}
            {u.role === "admin" ? " (admin)" : ""}
          </option>
        ))}
      </select>
      <FormMessage tone={state?.status === "success" ? "success" : "error"}>
        {state?.message}
      </FormMessage>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Salvataggio…" : "Collega manager"}
      </Button>
    </form>
  );
}

export function CreditsForm({ teamId, credits }: { teamId: string; credits: number }) {
  const [state, action, pending] = useActionState(setTeamCredits, undefined);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="teamId" value={teamId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="credits">Crediti residui</Label>
        <Input
          id="credits"
          name="credits"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          defaultValue={credits}
          className="tabular"
        />
        <FieldError errors={state?.errors?.credits} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note">Motivazione</Label>
        <Input id="note" name="note" maxLength={200} placeholder="es. correzione post asta" />
      </div>
      <FormMessage tone={state?.status === "success" ? "success" : "error"}>
        {state?.message}
      </FormMessage>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Salvataggio…" : "Aggiorna crediti"}
      </Button>
    </form>
  );
}

export function AssignPlayerForm({
  teamId,
  players,
}: {
  teamId: string;
  players: { id: number; label: string; qtA: number }[];
}) {
  const [state, action, pending] = useActionState(assignPlayer, undefined);
  const [query, setQuery] = useState("");
  const [price, setPrice] = useState("");
  const listId = useId();
  const selected = players.find((p) => p.label === query);

  return (
    <form
      action={action}
      className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_auto]"
      noValidate
    >
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="playerId" value={selected?.id ?? ""} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="playerSearch">Calciatore</Label>
        <Input
          id="playerSearch"
          list={listId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            const hit = players.find((p) => p.label === e.target.value);
            if (hit) setPrice(String(hit.qtA));
          }}
          placeholder="Scrivi il nome e scegli dalla lista"
          autoComplete="off"
        />
        <datalist id={listId}>
          {players.map((p) => (
            <option key={p.id} value={p.label} />
          ))}
        </datalist>
        <FieldError errors={state?.errors?.playerId} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="price">Prezzo</Label>
        <Input
          id="price"
          name="price"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="tabular"
        />
        <FieldError errors={state?.errors?.price} />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending || !selected} className="w-full sm:w-auto">
          {pending ? "Aggiunta…" : "Aggiungi"}
        </Button>
      </div>
      <FormMessage
        tone={state?.status === "success" ? "success" : "error"}
        className="sm:col-span-3"
      >
        {state?.message}
      </FormMessage>
    </form>
  );
}

export function RemovePlayerButton({
  teamId,
  playerId,
  defaultRefund,
  name,
}: {
  teamId: string;
  playerId: number;
  defaultRefund: number;
  name: string;
}) {
  const [state, action, pending] = useActionState(removePlayer, undefined);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Rimuovi ${name}`}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    );
  }

  return (
    <form action={action} className="inline-flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="playerId" value={playerId} />
      <label className="text-muted inline-flex items-center gap-1 text-xs">
        rimborso
        <Input
          name="refund"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          defaultValue={defaultRefund}
          className="tabular w-20"
          aria-label={`Rimborso per ${name}`}
        />
      </label>
      <Button type="submit" variant="danger" size="sm" disabled={pending}>
        {pending ? "…" : "Conferma"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Annulla
      </Button>
      {state?.status === "error" && <FormMessage className="w-full">{state.message}</FormMessage>}
    </form>
  );
}
