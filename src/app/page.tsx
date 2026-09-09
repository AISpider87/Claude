import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/dal";

export default async function HomePage() {
  const user = await getCurrentUser();
  redirect(user ? "/rosa" : "/login");
}
