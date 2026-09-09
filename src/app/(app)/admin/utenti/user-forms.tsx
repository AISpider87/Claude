"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { setUserActive, setUserRole } from "@/lib/admin/actions";
import type { AdminUser } from "@/lib/supabase/database.types";

export function UserActions({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(setUserRole, undefined);
  const [activeState, activeAction, activePending] = useActionState(setUserActive, undefined);
  const message = roleState?.message ?? activeState?.message;
  const tone =
    roleState?.status === "success" || activeState?.status === "success" ? "success" : "error";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <form action={roleAction}>
          <input type="hidden" name="userId" value={user.user_id} />
          <input type="hidden" name="role" value={user.role === "admin" ? "manager" : "admin"} />
          <Button type="submit" variant="secondary" size="sm" disabled={rolePending || isSelf}>
            {rolePending ? "…" : user.role === "admin" ? "Rendi manager" : "Rendi admin"}
          </Button>
        </form>
        <form action={activeAction}>
          <input type="hidden" name="userId" value={user.user_id} />
          <input type="hidden" name="active" value={user.is_active ? "false" : "true"} />
          <Button
            type="submit"
            variant={user.is_active ? "danger" : "primary"}
            size="sm"
            disabled={activePending || isSelf}
          >
            {activePending ? "…" : user.is_active ? "Disattiva" : "Riattiva"}
          </Button>
        </form>
      </div>
      {message && (
        <FormMessage tone={tone} className="w-full text-left">
          {message}
        </FormMessage>
      )}
    </div>
  );
}
