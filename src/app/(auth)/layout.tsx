import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="safe-top safe-bottom flex flex-1 flex-col items-center justify-center px-4 py-8">
      <Link href="/login" className="mb-8" aria-label="SuperLega">
        <Logo />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
      <p className="text-muted mt-8 text-center text-xs">SuperLega 2026/27 · lega privata</p>
    </main>
  );
}
