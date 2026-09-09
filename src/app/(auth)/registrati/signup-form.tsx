"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { signUp } from "@/lib/auth/actions";

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUp, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">Il tuo nome</Label>
        <Input id="displayName" name="displayName" autoComplete="name" required />
        <FieldError errors={state?.errors?.displayName} />
      </div>
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
        <p className="text-muted text-xs">Almeno 8 caratteri.</p>
        <FieldError errors={state?.errors?.password} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="leagueCode">Codice lega</Label>
        <Input
          id="leagueCode"
          name="leagueCode"
          autoComplete="off"
          autoCapitalize="characters"
          className="font-display tracking-widest uppercase"
          required
        />
        <FieldError errors={state?.errors?.leagueCode} />
      </div>
      <FormMessage>{state?.message}</FormMessage>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Registrazione…" : "Registrati"}
      </Button>
    </form>
  );
}
