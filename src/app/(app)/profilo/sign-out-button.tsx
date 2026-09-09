import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="secondary">
        <LogOut className="size-4" aria-hidden />
        Esci
      </Button>
    </form>
  );
}
