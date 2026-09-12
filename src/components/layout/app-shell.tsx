import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { AppHeader } from "@/components/layout/app-header";
import { MainNav, type NavItem } from "@/components/layout/main-nav";
import { AmbientBackdrop } from "@/components/motion/ambient-backdrop";
import { IntroScript, LoginIntro } from "@/components/motion/login-intro";
import { PageTransition } from "@/components/motion/page-transition";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import type { CurrentUser } from "@/lib/auth/dal";

const MANAGER_NAV: NavItem[] = [
  { href: "/rosa", label: "Rosa", icon: "users" },
  { href: "/mercato", label: "Mercato", icon: "repeat" },
  { href: "/listone", label: "Listone", icon: "list" },
  { href: "/profilo", label: "Profilo", icon: "user" },
];

const ADMIN_NAV: NavItem[] = [{ href: "/admin", label: "Admin", icon: "shield" }];

export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const items = user.role === "admin" ? [...MANAGER_NAV, ...ADMIN_NAV] : MANAGER_NAV;

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Paints the intro ground before the first paint when arriving from the
          sign-in, so the cinematic never starts with a flash of the page. */}
      <IntroScript />
      {/* Slow lights drifting behind every page: decorative, never in the way. */}
      <AmbientBackdrop />
      {/* Desktop sidebar */}
      <aside className="border-line bg-surface/80 hidden w-60 shrink-0 flex-col border-r p-4 backdrop-blur lg:flex">
        <Link href="/rosa" className="mb-6 px-2" aria-label="The SuperLeague">
          <Logo />
        </Link>
        <MainNav items={items} orientation="vertical" />
        <div className="mt-auto flex items-center justify-between gap-2 px-2">
          <p className="text-muted truncate text-xs" title={user.email}>
            {user.displayName}
          </p>
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header: slim, lifts off the page when it scrolls */}
        <AppHeader>
          <Link href="/rosa" aria-label="The SuperLeague">
            <Logo />
          </Link>
          <span className="flex min-w-0 items-center gap-1">
            <span className="text-muted truncate text-sm">{user.displayName}</span>
            <ThemeToggle />
          </span>
        </AppHeader>

        <main id="main" className="flex-1 px-4 pt-4 pb-24 lg:px-8 lg:py-8">
          <PageTransition>{children}</PageTransition>
        </main>

        {/* Mobile bottom nav */}
        <nav
          aria-label="Navigazione principale"
          className="safe-bottom border-line bg-background/90 fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur lg:hidden"
        >
          <MainNav items={items} orientation="horizontal" />
        </nav>
      </div>

      {/* One-shot cinematic after a sign-in; renders nothing on a normal load. */}
      <LoginIntro />
    </div>
  );
}
