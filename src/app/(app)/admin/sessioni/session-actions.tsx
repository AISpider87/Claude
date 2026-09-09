"use client";

import { useActionState, useState } from "react";
import { Lock, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { closeSession, deleteSession, openSession } from "@/lib/market/actions";
import type { MarketSession } from "@/lib/supabase/database.types";

export function SessionActions({
  session,
  compact = false,
}: {
  session: MarketSession;
  compact?: boolean;
}) {
  const [openState, openAction, opening] = useActionState(openSession, undefined);
  const [closeState, closeAction, closing] = useActionState(closeSession, undefined);
  const [confirmClose, setConfirmClose] = useState(false);
  const message = openState?.message ?? closeState?.message;
  const tone =
    openState?.status === "success" || closeState?.status === "success" ? "success" : "error";

  return (
    <div
      className={
        compact ? "inline-flex flex-wrap items-center justify-end gap-2" : "flex flex-col gap-3"
      }
    >
      {session.status === "scheduled" && (
        <>
          <form action={openAction}>
            <input type="hidden" name="id" value={session.id} />
            <Button type="submit" size={compact ? "sm" : "default"} disabled={opening}>
              <Play className="size-4" aria-hidden /> {opening ? "Apertura…" : "Apri ora"}
            </Button>
          </form>
          <form action={deleteSession}>
            <input type="hidden" name="id" value={session.id} />
            <Button
              type="submit"
              variant="ghost"
              size={compact ? "sm" : "default"}
              aria-label="Elimina sessione"
            >
              <Trash2 className="size-4" aria-hidden /> {!compact && "Elimina"}
            </Button>
          </form>
        </>
      )}
      {session.status === "open" &&
        (confirmClose ? (
          <form action={closeAction} className="inline-flex items-center gap-2">
            <input type="hidden" name="id" value={session.id} />
            <Button
              type="submit"
              variant="danger"
              size={compact ? "sm" : "default"}
              disabled={closing}
            >
              <Lock className="size-4" aria-hidden /> {closing ? "Chiusura…" : "Chiudi davvero"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size={compact ? "sm" : "default"}
              onClick={() => setConfirmClose(false)}
            >
              Annulla
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size={compact ? "sm" : "default"}
            onClick={() => setConfirmClose(true)}
          >
            <Lock className="size-4" aria-hidden /> Chiudi sessione
          </Button>
        ))}
      {message && !compact && <FormMessage tone={tone}>{message}</FormMessage>}
      {message && compact && tone === "error" && (
        <FormMessage className="w-full">{message}</FormMessage>
      )}
    </div>
  );
}
