"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { requestPasswordReset } from "@/lib/auth/actions";

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);

  if (state?.status === "success") {
    return <FormMessage tone="success">{state.message}</FormMessage>;
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
        />
        <FieldError errors={state?.errors?.email} />
      </div>
      <FormMessage>{state?.message}</FormMessage>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Invio…" : "Invia il link"}
      </Button>
    </form>
  );
}
