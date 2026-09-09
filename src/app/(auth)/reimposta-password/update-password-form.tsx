"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { updatePassword } from "@/lib/auth/actions";

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Nuova password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
        <FieldError errors={state?.errors?.password} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">Ripeti la password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        <FieldError errors={state?.errors?.confirm} />
      </div>
      <FormMessage>{state?.message}</FormMessage>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Salvataggio…" : "Salva la password"}
      </Button>
    </form>
  );
}
