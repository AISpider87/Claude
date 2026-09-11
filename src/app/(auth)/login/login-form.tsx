"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { signIn } from "@/lib/auth/actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);

  // While the sign-in is in flight, fetch the cinematic's chunk so it is in
  // cache when the destination page mounts and the intro starts at once.
  useEffect(() => {
    if (pending) void import("@/components/motion/intro-stage");
  }, [pending]);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
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
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <FieldError errors={state?.errors?.password} />
      </div>
      <FormMessage>{state?.message}</FormMessage>
      <Button
        type="submit"
        disabled={pending}
        data-pending={pending ? "true" : "false"}
        className="btn-launch w-full"
      >
        {pending ? "Accesso in corso…" : "Accedi"}
      </Button>
    </form>
  );
}
