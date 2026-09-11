"use client";

import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setPlayerStatus } from "@/lib/admin/actions";
import type { PlayerStatusKind } from "@/lib/supabase/database.types";

export interface PlayerOption {
  id: number;
  name: string;
  team: string;
  role: string;
}

const KINDS: { value: PlayerStatusKind; label: string }[] = [
  { value: "injured", label: "Infortunato" },
  { value: "doubtful", label: "In dubbio" },
  { value: "suspended", label: "Squalificato" },
  { value: "unavailable", label: "Indisponibile (altro)" },
];

const controlClass =
  "border-line bg-surface min-h-11 w-full rounded-[var(--radius-control)] border px-3 text-sm";

/** Admin: set a player's availability by hand, with the source of the news. */
export function StatusForm({ players }: { players: PlayerOption[] }) {
  const [state, action, pending] = useActionState(setPlayerStatus, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor="status-player">Calciatore</Label>
        <select
          id="status-player"
          name="playerId"
          required
          className={controlClass}
          defaultValue=""
        >
          <option value="">— scegli dal listone —</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.role} · {p.team}
            </option>
          ))}
        </select>
        <FormMessage>{state?.errors?.playerId?.[0]}</FormMessage>
      </div>
      <div>
        <Label htmlFor="status-kind">Stato</Label>
        <select id="status-kind" name="kind" className={controlClass} defaultValue="injured">
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="status-note">Nota (es. rientro previsto)</Label>
        <Input
          id="status-note"
          name="note"
          maxLength={200}
          placeholder="Lesione muscolare, rientro a ottobre"
        />
        <FormMessage>{state?.errors?.note?.[0]}</FormMessage>
      </div>
      <div>
        <Label htmlFor="status-source">Fonte</Label>
        <Input id="status-source" name="sourceName" maxLength={60} placeholder="Fantacalcio.it" />
      </div>
      <div>
        <Label htmlFor="status-url">Link alla fonte</Label>
        <Input
          id="status-url"
          name="sourceUrl"
          type="url"
          inputMode="url"
          placeholder="https://…"
        />
        <FormMessage>{state?.errors?.sourceUrl?.[0]}</FormMessage>
      </div>
      <div className="sm:col-span-2">
        <FormMessage tone={state?.status === "success" ? "success" : "error"}>
          {state?.message}
        </FormMessage>
        <Button type="submit" disabled={pending} className="mt-2">
          <Check className="size-4" aria-hidden /> {pending ? "Salvataggio…" : "Salva stato"}
        </Button>
      </div>
    </form>
  );
}

/** Admin: clear a status (the player is available again). */
export function ClearStatusButton({ playerId, name }: { playerId: number; name: string }) {
  const [state, action, pending] = useActionState(setPlayerStatus, undefined);
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="kind" value="ok" />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Rimuovi lo stato di ${name}`}
      >
        <X className="size-4" aria-hidden /> {pending ? "…" : "Disponibile"}
      </Button>
      {state?.status === "error" && <FormMessage>{state.message}</FormMessage>}
    </form>
  );
}
