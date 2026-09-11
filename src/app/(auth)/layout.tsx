import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main"
      className="safe-top safe-bottom relative flex flex-1 flex-col items-center justify-center px-4 py-8"
    >
      {/* The vortex of the sign-in cinematic, already here behind the form: the
          same 38 KB file, so the intro finds it in cache. Dark theme only. */}
      <div className="auth-backdrop" aria-hidden />
      <Link href="/login" className="relative mb-8" aria-label="The SuperLeague">
        <Logo />
      </Link>
      <div className="relative w-full max-w-sm">{children}</div>
      <p className="text-muted relative mt-8 text-center text-xs">
        The SuperLeague 2026/27 · lega privata
      </p>
    </main>
  );
}
