import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "manager";

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isActive: boolean;
}

/** Verified user + profile for this request, or null. Memoized per render pass. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    displayName: profile.display_name,
    role: profile.role as Role,
    isActive: profile.is_active,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isActive) redirect("/account-disattivato");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/rosa");
  return user;
}
