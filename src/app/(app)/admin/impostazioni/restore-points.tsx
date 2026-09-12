"use client";

import { useActionState, useState } from "react";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createRestorePoint, deleteRestorePoint, restoreLeague } from "@/lib/admin/actions";
import { formatDateTime } from "@/lib/format";

export interface RestorePointView {
  id: string;
  label: string;
  takenAt: string;
  auto: boolean;
  teams: number;
  roster: number;
  operationsAfter: number;
}

/** "Salva lo stato di adesso": a new photograph of the league. */
function CreateForm() {
  const [state, action, pending] = useActionState(createRestorePoint, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <Label htmlFor="restore-label">Salva lo stato di adesso</Label>
      <div className="flex flex-wrap items-start gap-2">
        <Input
          id="restore-label"
          name="label"
          placeholder="es. Prima della sessione di prova"
          maxLength={80}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Salvataggio…" : "Salva punto"}
        </Button>
      </div>
      <FieldError errors={state?.errors?.label} />
      <FormMessage tone={state?.status === "success" ? "success" : "error"}>
        {state?.message}
      </FormMessage>
    </form>
  );
}

/**
 * Restoring throws away everything that happened after the point, so it asks
 * for the word RIPRISTINA typed by hand (the server checks it again).
 */
function RestoreForm({ point }: { point: RestorePointView }) {
  const [state, action, pending] = useActionState(restoreLeague, undefined);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <RotateCcw className="size-4" aria-hidden /> Ripristina
      </Button>
    );
  }
  return (
    <form
      action={action}
      className="border-line bg-surface-2 flex flex-col gap-2 rounded-[var(--radius-control)] border p-3"
    >
      <input type="hidden" name="id" value={point.id} />
      <p className="text-sm">
        Riporti la lega a <strong>{point.label}</strong>: rose, crediti e cambi come allora.
        {point.operationsAfter > 0 && (
          <>
            {" "}
            <span className="text-danger font-semibold">
              {point.operationsAfter} {point.operationsAfter === 1 ? "operazione" : "operazioni"}{" "}
              successive verranno cancellate
            </span>{" "}
            e le sessioni torneranno da rigiocare.
          </>
        )}
      </p>
      <Label htmlFor={`confirm-${point.id}`}>Scrivi RIPRISTINA per confermare</Label>
      <Input
        id={`confirm-${point.id}`}
        name="confirm"
        autoComplete="off"
        spellCheck={false}
        className="uppercase"
      />
      <FormMessage tone={state?.status === "success" ? "success" : "error"}>
        {state?.message}
      </FormMessage>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          {pending ? "Ripristino…" : "Ripristina ora"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Annulla
        </Button>
      </div>
    </form>
  );
}

export function RestorePoints({ points }: { points: RestorePointView[] }) {
  return (
    <div className="flex flex-col gap-4">
      <CreateForm />
      {points.length === 0 ? (
        <p className="text-muted text-sm">
          Nessun punto salvato: ne viene creato uno da sé a ogni import delle rose.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {points.map((p) => (
            <li
              key={p.id}
              className="border-line flex flex-col gap-2 rounded-[var(--radius-control)] border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <History className="text-primary size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">{p.label}</span>
                {p.auto && (
                  <Badge variant="muted" className="shrink-0 text-[10px]">
                    automatico
                  </Badge>
                )}
              </div>
              <p className="text-muted text-xs">
                {formatDateTime(p.takenAt)} · {p.teams} squadre · {p.roster} giocatori in rosa
                {p.operationsAfter > 0 && ` · ${p.operationsAfter} operazioni dopo`}
              </p>
              <div className="flex flex-wrap items-start gap-2">
                <RestoreForm point={p} />
                <form action={deleteRestorePoint}>
                  <input type="hidden" name="id" value={p.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    aria-label={`Elimina il punto ${p.label}`}
                  >
                    <Trash2 className="size-4" aria-hidden /> Elimina
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
