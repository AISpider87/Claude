"use client";

import { useActionState, useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { reverseTransaction } from "@/lib/market/actions";

export function ReverseButton({ txId }: { txId: string }) {
  const [state, action, pending] = useActionState(reverseTransaction, undefined);
  const [open, setOpen] = useState(false);

  if (state?.status === "success") {
    return <FormMessage tone="success">{state.message}</FormMessage>;
  }
  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Annulla operazione"
      >
        <Undo2 className="size-4" aria-hidden /> Annulla
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col items-end gap-2" noValidate>
      <input type="hidden" name="txId" value={txId} />
      <Input
        name="reason"
        placeholder="Motivazione"
        maxLength={300}
        className="w-56"
        aria-label="Motivazione"
        required
      />
      <FieldError errors={state?.errors?.reason} />
      <FormMessage>{state?.message}</FormMessage>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          {pending ? "…" : "Conferma annullamento"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Chiudi
        </Button>
      </div>
    </form>
  );
}
