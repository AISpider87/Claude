import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { MainNav, type NavItem } from "@/components/layout/main-nav";
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
      {/* Desktop sidebar */}
      <aside className="border-line bg-surface/80 hidden w-60 shrink-0 flex-col border-r p-4 lg:flex">
        <Link href="/rosa" className="mb-6 px-2" aria-label="SuperLega">
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
        {/* Mobile header */}
        <header className="safe-top border-line bg-background/85 sticky top-0 z-20 flex items-center justify-between border-b px-4 py-2 backdrop-blur lg:hidden">
          <Link href="/rosa" aria-label="SuperLega">
            <Logo />
          </Link>
          <span className="flex min-w-0 items-center gap-1">
            <span className="text-muted truncate text-sm">{user.displayName}</span>
            <ThemeToggle />
          </span>
        </header>

        <main id="main" className="flex-1 px-4 pt-4 pb-24 lg:px-8 lg:py-8">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav
          aria-label="Navigazione principale"
          className="safe-bottom border-line bg-background/90 fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur lg:hidden"
        >
          <MainNav items={items} orientation="horizontal" />
        </nav>
      </div>
    </div>
  );
}
